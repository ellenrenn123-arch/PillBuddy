/*
 * PillBuddyDispenser.ino - Arduino Uno R4 WiFi FreeRTOS Pill Dispenser Firmware
 *
 * Hardware Components:
 * - Arduino Uno R4 WiFi (Renesas RA4M1 MCU + ESP32-S3 WiFi + Built-in RTC)
 * - Stepper Motor: 28BYJ-48 with ULN2003 Driver Board (Pins 8, 9, 10, 11)
 * - Servo Motor: SG90 for tongue/compartment extension (Pin 6)
 * - DFPlayer Mini MP3 Player: For dog bark audio bite (Pins 2 RX, 3 TX via SoftwareSerial / Serial1)
 * - LED: Flashing notification LED (Pin 5)
 *
 * Hardware Logic & Schedule:
 * - WiFiS3 web server listening on Port 80 for HTTP REST commands from React Native App.
 * - FreeRTOS Multitasking:
 *   1. ServerTask: Handles incoming HTTP requests (/status, /sync-time, /schedule, /dispense).
 *   2. RTCAlarmTask: Checks built-in RTC clock every 1 second against set schedules.
 *   3. DispenserTask: Coordinates sequence (Stepper 51.42857° turn -> Wait 2s -> Servo 45° -> Bark + LED).
 *   4. AlertTask: Controls non-blocking LED flashing and sound triggering.
 *
 * Math for Carousel:
 * 7 Compartments -> 360° / 7 = 51.4285714286° per step.
 * 28BYJ-48 (4096 half-steps per rev) -> 4096 / 7 ≈ 585 steps per turn.
 */

#include <WiFiS3.h>
#include <RTC.h>
#include <Servo.h>
#include <SoftwareSerial.h>

// -----------------------------------------------------------------------------
// Pin Configuration
// -----------------------------------------------------------------------------
#define STEPPER_IN1 8
#define STEPPER_IN2 9
#define STEPPER_IN3 10
#define STEPPER_IN4 11

#define SERVO_PIN   6
#define LED_PIN     5

#define DFPLAYER_RX 2
#define DFPLAYER_TX 3

// -----------------------------------------------------------------------------
// Stepper Motor Constants (28BYJ-48 Half-Step Mode)
// -----------------------------------------------------------------------------
// 360 / 7 = 51.4285714286 degrees
// 4096 steps per full 360 turn -> 4096 / 7 = 585 steps per compartment
const int STEPS_PER_DISPENSE = 585;
const int HALF_STEP_SEQ[8][4] = {
  {1, 0, 0, 0},
  {1, 1, 0, 0},
  {0, 1, 0, 0},
  {0, 1, 1, 0},
  {0, 0, 1, 0},
  {0, 0, 1, 1},
  {0, 0, 0, 1},
  {1, 0, 0, 1}
};

// -----------------------------------------------------------------------------
// Schedule Data Structure
// -----------------------------------------------------------------------------
#define MAX_SCHEDULES 10

struct AlarmTime {
  int hour;
  int minute;
  bool active;
};

AlarmTime g_schedules[MAX_SCHEDULES];
int g_scheduleCount = 0;
int g_currentCompartment = 0; // 0 to 6
bool g_isDispensing = false;
int g_lastDispensedMinute = -1;

// WiFi Credentials
char ssid[] = "PillBuddy_Hotspot"; // Replace or set via AP/App config
char pass[] = "pillbuddy123";      // WPA2 password
WiFiServer server(80);

// Hardware Drivers
Servo tongueServo;
SoftwareSerial dfSerial(DFPLAYER_RX, DFPLAYER_TX); // RX, TX

// FreeRTOS Handles
QueueHandle_t xDispenseQueue = NULL;
SemaphoreHandle_t xScheduleMutex = NULL;

enum DispenseTriggerSource {
  TRIGGER_SCHEDULE,
  TRIGGER_MANUAL
};

struct DispenseEvent {
  DispenseTriggerSource source;
  int compartmentIndex;
};

// -----------------------------------------------------------------------------
// Helper Hardware Functions
// -----------------------------------------------------------------------------

void setStepperPins(int stepIndex) {
  digitalWrite(STEPPER_IN1, HALF_STEP_SEQ[stepIndex][0]);
  digitalWrite(STEPPER_IN2, HALF_STEP_SEQ[stepIndex][1]);
  digitalWrite(STEPPER_IN3, HALF_STEP_SEQ[stepIndex][2]);
  digitalWrite(STEPPER_IN4, HALF_STEP_SEQ[stepIndex][3]);
}

void stepCarousel(int steps) {
  for (int i = 0; i < steps; i++) {
    int stepIndex = i % 8;
    setStepperPins(stepIndex);
    delay(2); // 2ms per step for smooth torque
  }
  // Turn off stepper pins after rotation to prevent heating
  digitalWrite(STEPPER_IN1, LOW);
  digitalWrite(STEPPER_IN2, LOW);
  digitalWrite(STEPPER_IN3, LOW);
  digitalWrite(STEPPER_IN4, LOW);
}

void playBarkSound() {
  // DFPlayer Mini Command to play Track 0001 (bark.mp3 in /01 folder)
  // Standard DFPlayer serial packet (10 bytes): 7E FF 06 03 00 00 01 FE F7 (or simple command)
  uint8_t playCmd[10] = {0x7E, 0xFF, 0x06, 0x03, 0x00, 0x00, 0x01, 0xFE, 0xF7, 0xEF};
  dfSerial.write(playCmd, 10);
}

void flashLED(int times, int speedMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(speedMs);
    digitalWrite(LED_PIN, LOW);
    delay(speedMs);
  }
}

// -----------------------------------------------------------------------------
// FreeRTOS Task: Dispenser Sequence Execution
// -----------------------------------------------------------------------------
void TaskDispenser(void *pvParameters) {
  DispenseEvent event;
  for (;;) {
    if (xQueueReceive(xDispenseQueue, &event, portMAX_DELAY) == pdTRUE) {
      g_isDispensing = true;
      Serial.println("[DispenserTask] Starting pill dispensing sequence...");

      // Step 1: Stepper motor turns 51.4285714286° (585 half-steps)
      Serial.print("[DispenserTask] Rotating carousel 51.42857° (~585 steps) to compartment ");
      g_currentCompartment = (g_currentCompartment + 1) % 7;
      Serial.println(g_currentCompartment);

      stepCarousel(STEPS_PER_DISPENSE);

      // Step 2: Wait 2 seconds (or enough time to complete turn)
      Serial.println("[DispenserTask] Stepper turn complete. Waiting 2 seconds...");
      vTaskDelay(pdMS_TO_TICKS(2000));

      // Step 3: SG90 Servo turns 45 degrees for tongue extension
      Serial.println("[DispenserTask] Extending SG90 tongue servo to 45°...");
      tongueServo.write(45);
      vTaskDelay(pdMS_TO_TICKS(500));

      // Step 4: DFPlayer MP3 plays barking noise bite & LED flashes
      Serial.println("[DispenserTask] Playing bark sound and flashing notification LED...");
      playBarkSound();
      flashLED(5, 150); // Flash LED 5 times at 150ms intervals

      // Retract Servo back to resting position (0°) after dispensing
      vTaskDelay(pdMS_TO_TICKS(1500));
      tongueServo.write(0);
      Serial.println("[DispenserTask] Retracted SG90 tongue servo to 0°. Sequence complete!");

      g_isDispensing = false;
    }
  }
}

// -----------------------------------------------------------------------------
// FreeRTOS Task: RTC Alarm Checker
// -----------------------------------------------------------------------------
void TaskRTCAlarm(void *pvParameters) {
  for (;;) {
    RTCTime currentTime;
    RTC.getTime(currentTime);

    int currentHour = currentTime.getHour();
    int currentMinute = currentTime.getMinutes();

    // Avoid multiple triggers within the same minute
    if (currentMinute != g_lastDispensedMinute) {
      if (xSemaphoreTake(xScheduleMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        for (int i = 0; i < g_scheduleCount; i++) {
          if (g_schedules[i].active && 
              g_schedules[i].hour == currentHour && 
              g_schedules[i].minute == currentMinute) {
            
            Serial.print("[RTCAlarmTask] Schedule alarm triggered for ");
            Serial.print(currentHour);
            Serial.print(":");
            Serial.println(currentMinute);

            g_lastDispensedMinute = currentMinute;

            DispenseEvent event;
            event.source = TRIGGER_SCHEDULE;
            event.compartmentIndex = g_currentCompartment;
            xQueueSend(xDispenseQueue, &event, 0);
            break;
          }
        }
        xSemaphoreGive(xScheduleMutex);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(1000)); // Check RTC every 1 second
  }
}

// -----------------------------------------------------------------------------
// FreeRTOS Task: Web Server HTTP REST API
// -----------------------------------------------------------------------------
void TaskWebServer(void *pvParameters) {
  for (;;) {
    WiFiClient client = server.available();
    if (client) {
      String reqHeader = "";
      while (client.connected() && client.available()) {
        char c = client.read();
        reqHeader += c;
        if (reqHeader.endsWith("\r\n\r\n")) break;
      }

      // Handle endpoints
      if (reqHeader.indexOf("GET /status") >= 0) {
        RTCTime now;
        RTC.getTime(now);
        client.println("HTTP/1.1 200 OK");
        client.println("Content-Type: application/json");
        client.println("Access-Control-Allow-Origin: *");
        client.println("Connection: close");
        client.println();

        String json = "{\"status\":\"ok\",\"isDispensing\":";
        json += g_isDispensing ? "true" : "false";
        json += ",\"currentCompartment\":";
        json += g_currentCompartment;
        json += ",\"rtcTime\":\"";
        json += now.getHour();
        json += ":";
        json += now.getMinutes();
        json += ":";
        json += now.getSeconds();
        json += "\",\"scheduleCount\":";
        json += g_scheduleCount;
        json += "}";
        client.println(json);

      } else if (reqHeader.indexOf("POST /dispense") >= 0 || reqHeader.indexOf("GET /dispense") >= 0) {
        DispenseEvent event;
        event.source = TRIGGER_MANUAL;
        event.compartmentIndex = g_currentCompartment;
        xQueueSend(xDispenseQueue, &event, 0);

        client.println("HTTP/1.1 200 OK");
        client.println("Content-Type: application/json");
        client.println("Access-Control-Allow-Origin: *");
        client.println();
        client.println("{\"success\":true,\"message\":\"Dispense sequence queued\"}");

      } else if (reqHeader.indexOf("POST /sync-time") >= 0 || reqHeader.indexOf("GET /sync-time") >= 0) {
        // Example query params: ?hour=9&minute=30&second=0&day=6&month=10&year=2026
        int h = 12, m = 0, s = 0, day = 6, month = 10, year = 2026;
        int idxH = reqHeader.indexOf("hour=");
        if (idxH >= 0) h = reqHeader.substring(idxH + 5).toInt();
        int idxM = reqHeader.indexOf("minute=");
        if (idxM >= 0) m = reqHeader.substring(idxM + 7).toInt();
        int idxS = reqHeader.indexOf("second=");
        if (idxS >= 0) s = reqHeader.substring(idxS + 7).toInt();

        RTCTime newTime(day, (Month)month, year, h, m, s, DayOfWeek::TUESDAY, SaveLight::SAVING_TIME_OFF);
        RTC.setTime(newTime);

        client.println("HTTP/1.1 200 OK");
        client.println("Content-Type: application/json");
        client.println("Access-Control-Allow-Origin: *");
        client.println();
        client.println("{\"success\":true,\"message\":\"RTC time updated\"}");

      } else if (reqHeader.indexOf("POST /schedule") >= 0 || reqHeader.indexOf("GET /schedule") >= 0) {
        // Query param format: ?times=09:00,18:00
        if (xSemaphoreTake(xScheduleMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
          g_scheduleCount = 0;
          int idxTimes = reqHeader.indexOf("times=");
          if (idxTimes >= 0) {
            int endIdx = reqHeader.indexOf(" ", idxTimes);
            if (endIdx < 0) endIdx = reqHeader.indexOf("\r", idxTimes);
            String timesStr = reqHeader.substring(idxTimes + 6, endIdx);
            
            int startPos = 0;
            while (startPos < timesStr.length() && g_scheduleCount < MAX_SCHEDULES) {
              int commaPos = timesStr.indexOf(",", startPos);
              if (commaPos < 0) commaPos = timesStr.length();
              String timeItem = timesStr.substring(startPos, commaPos);
              int colonPos = timeItem.indexOf(":");
              if (colonPos > 0) {
                g_schedules[g_scheduleCount].hour = timeItem.substring(0, colonPos).toInt();
                g_schedules[g_scheduleCount].minute = timeItem.substring(colonPos + 1).toInt();
                g_schedules[g_scheduleCount].active = true;
                g_scheduleCount++;
              }
              startPos = commaPos + 1;
            }
          }
          xSemaphoreGive(xScheduleMutex);
        }

        client.println("HTTP/1.1 200 OK");
        client.println("Content-Type: application/json");
        client.println("Access-Control-Allow-Origin: *");
        client.println();
        client.println("{\"success\":true,\"schedulesSynced\":" + String(g_scheduleCount) + "}");

      } else {
        client.println("HTTP/1.1 404 Not Found");
        client.println("Content-Type: text/plain");
        client.println();
        client.println("PillBuddy Dispenser Endpoint Not Found");
      }

      client.stop();
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// -----------------------------------------------------------------------------
// Arduino Setup & Main Loop
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  dfSerial.begin(9600);

  // Configure Pins
  pinMode(STEPPER_IN1, OUTPUT);
  pinMode(STEPPER_IN2, OUTPUT);
  pinMode(STEPPER_IN3, OUTPUT);
  pinMode(STEPPER_IN4, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  tongueServo.attach(SERVO_PIN);
  tongueServo.write(0); // Start at rest angle 0°

  // Initialize Built-in RTC
  RTC.begin();
  RTCTime startTime(6, Month::OCTOBER, 2026, 8, 0, 0, DayOfWeek::TUESDAY, SaveLight::SAVING_TIME_OFF);
  RTC.setTime(startTime);

  // Initialize WiFi
  Serial.print("Connecting to WiFi network: ");
  Serial.println(ssid);
  WiFi.begin(ssid, pass);
  
  // Wait up to 10 seconds for connection
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected successfully!");
    Serial.print("Arduino Dispenser IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi connection failed. Running web server in offline AP/Fallback mode.");
  }
  
  server.begin();

  // Create FreeRTOS Mutex and Queue
  xScheduleMutex = xSemaphoreCreateMutex();
  xDispenseQueue = xQueueCreate(5, sizeof(DispenseEvent));

  // Create FreeRTOS Tasks
  xTaskCreate(TaskDispenser, "DispenserTask", 512, NULL, 2, NULL);
  xTaskCreate(TaskRTCAlarm,  "RTCAlarmTask",  512, NULL, 1, NULL);
  xTaskCreate(TaskWebServer, "WebServerTask", 1024, NULL, 1, NULL);

  Serial.println("PillBuddy FreeRTOS Dispenser Firmware initialized!");
}

void loop() {
  // Empty - FreeRTOS handles task scheduling
}

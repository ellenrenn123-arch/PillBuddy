import { Medication } from './types';

export interface DispenserStatus {
  status: string;
  isDispensing: boolean;
  currentCompartment: number;
  rtcTime: string;
  scheduleCount: number;
}

/**
 * Fetches the current hardware status from Arduino Uno R4 WiFi.
 */
export async function fetchHardwareStatus(ip: string): Promise<DispenserStatus | null> {
  try {
    const formattedIp = ip.replace(/^https?:\/\//, '').trim();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`http://${formattedIp}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Syncs the current phone time to the Arduino RTC clock module.
 */
export async function syncHardwareTime(ip: string): Promise<boolean> {
  try {
    const formattedIp = ip.replace(/^https?:\/\//, '').trim();
    const now = new Date();
    const params = new URLSearchParams({
      hour: now.getHours().toString(),
      minute: now.getMinutes().toString(),
      second: now.getSeconds().toString(),
      day: now.getDate().toString(),
      month: (now.getMonth() + 1).toString(),
      year: now.getFullYear().toString(),
    });

    const res = await fetch(`http://${formattedIp}/sync-time?${params.toString()}`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Syncs all active medication schedule times to the Arduino R4 WiFi dispenser.
 */
export async function syncHardwareSchedules(ip: string, meds: Medication[]): Promise<boolean> {
  try {
    const formattedIp = ip.replace(/^https?:\/\//, '').trim();
    const timeStrings = meds.map(m => {
      const h = String(m.hour).padStart(2, '0');
      const min = String(m.minute).padStart(2, '0');
      return `${h}:${min}`;
    }).join(',');

    const res = await fetch(`http://${formattedIp}/schedule?times=${encodeURIComponent(timeStrings)}`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Triggers an immediate manual dispensing sequence (51.42857° turn, servo 45°, bark sound & flash LED).
 */
export async function triggerManualDispense(ip: string): Promise<boolean> {
  try {
    const formattedIp = ip.replace(/^https?:\/\//, '').trim();
    const res = await fetch(`http://${formattedIp}/dispense`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Triggers carousel homing routine via limit switch on Pin 4.
 */
export async function triggerHoming(ip: string): Promise<boolean> {
  try {
    const formattedIp = ip.replace(/^https?:\/\//, '').trim();
    const res = await fetch(`http://${formattedIp}/home`);
    return res.ok;
  } catch {
    return false;
  }
}


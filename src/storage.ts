import AsyncStorage from '@react-native-async-storage/async-storage';
import { Medication } from './types';
import { scheduleDaily, cancelNotification } from './notifications';
import { syncHardwareSchedules } from './hardwareApi';

const KEY = 'medications';
const HARDWARE_IP_KEY = 'arduino_ip';

export const todayString = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`; // local date, not UTC
};

export async function loadMeds(): Promise<Medication[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}

const save = async (meds: Medication[]) => {
  await AsyncStorage.setItem(KEY, JSON.stringify(meds));
  const ip = await getArduinoIp();
  if (ip) {
    syncHardwareSchedules(ip, meds).catch(() => {});
  }
};

export async function getArduinoIp(): Promise<string> {
  return (await AsyncStorage.getItem(HARDWARE_IP_KEY)) || '';
}

export async function setArduinoIp(ip: string): Promise<void> {
  await AsyncStorage.setItem(HARDWARE_IP_KEY, ip.trim());
  const meds = await loadMeds();
  if (ip.trim()) {
    syncHardwareSchedules(ip.trim(), meds).catch(() => {});
  }
}

export async function addMed(input: {
  name: string; pillsRemaining: number; pillsPerDose: number; hour: number; minute: number;
}) {
  const id = Date.now().toString();
  const notificationId = await scheduleDaily({ id, ...input });
  const med: Medication = { id, ...input, lastTakenDate: null, notificationId };
  await save([...(await loadMeds()), med]);
}

export async function deleteMed(id: string) {
  const meds = await loadMeds();
  const med = meds.find((m) => m.id === id);
  if (med) await cancelNotification(med.notificationId);
  await save(meds.filter((m) => m.id !== id));
}

/** Subtracts pillsPerDose (never below 0). Does nothing if already taken today. */
export async function markTaken(id: string) {
  const today = todayString();
  const meds = await loadMeds();
  await save(
    meds.map((m) =>
      m.id === id && m.lastTakenDate !== today
        ? { ...m, pillsRemaining: Math.max(0, m.pillsRemaining - m.pillsPerDose), lastTakenDate: today }
        : m
    )
  );
}


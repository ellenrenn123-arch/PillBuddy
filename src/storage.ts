import AsyncStorage from '@react-native-async-storage/async-storage';
import { Medication } from './types';
import { scheduleDaily, cancelNotification } from './notifications';

const KEY = 'medications';

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

const save = (meds: Medication[]) => AsyncStorage.setItem(KEY, JSON.stringify(meds));

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

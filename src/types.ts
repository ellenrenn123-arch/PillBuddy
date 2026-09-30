export type Medication = {
  id: string;
  name: string;
  pillsRemaining: number;
  pillsPerDose: number;
  hour: number;              // 0-23
  minute: number;            // 0-59
  lastTakenDate: string | null; // 'YYYY-MM-DD', stops double "mark as taken"
  notificationId: string | null;
};

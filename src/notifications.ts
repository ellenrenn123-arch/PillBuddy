import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Medication } from './types';

export const CATEGORY = 'MED_REMINDER';
export const ACTION_TAKEN = 'MARK_TAKEN';
const CHANNEL = 'reminders';

// How notifications behave when the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Medication reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  await Notifications.setNotificationCategoryAsync(CATEGORY, [
    {
      identifier: ACTION_TAKEN,
      buttonTitle: 'Mark as taken',
      options: { opensAppToForeground: true },
    },
  ]);

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** Schedules a repeating daily notification and returns its id. */
export async function scheduleDaily(med: Pick<Medication, 'id' | 'name' | 'pillsPerDose' | 'hour' | 'minute'>) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `Time for ${med.name}`,
      body: `Take ${med.pillsPerDose} pill${med.pillsPerDose === 1 ? '' : 's'}`,
      categoryIdentifier: CATEGORY,
      data: { medId: med.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: med.hour,
      minute: med.minute,
      channelId: CHANNEL,
    },
  });
}

export async function cancelNotification(id: string | null) {
  if (id) await Notifications.cancelScheduledNotificationAsync(id);
}

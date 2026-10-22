import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Daily local rep-reminder (the reason Expo was chosen for mobile).
 * Local scheduled notifications work in Expo Go on both platforms; only
 * REMOTE push is unavailable in Expo Go on Android (SDK 53+).
 */

export function initNotificationHandler(): void {
  if (Platform.OS === 'web') return; // notifications are a native-only feature
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function applyReminder(enabled: boolean, hour: number): Promise<{ ok: boolean; msg?: string }> {
  if (Platform.OS === 'web') return { ok: false, msg: 'Reminders need the phone app (Expo Go).' };
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!enabled) return { ok: true };
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('daily', {
        name: 'Daily rep reminder',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return { ok: false, msg: 'Notification permission was denied in system settings.' };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'PropDrills — rep time',
        body: 'Your weakest patterns are due today. A few minutes of drills keeps the eye sharp.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute: 0,
        channelId: Platform.OS === 'android' ? 'daily' : undefined,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

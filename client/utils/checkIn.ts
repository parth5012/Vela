import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CHECKIN_CHANNEL_ID = 'vela_check_in';
export const CHECKIN_SCHEDULE_ID = 'vela-daily-checkin';
export const CHECKIN_DEEP_LINK = 'vela-client://checkin';
const CHECKIN_SETTINGS_KEY = 'vela.checkin.settings';

/** Expo weekday numbers: 1 = Sunday … 7 = Saturday. Empty = every day. */
export interface CheckinSettings {
  hour: number;
  minute: number;
  weekdays: number[];
  muted: boolean;
}

export const DEFAULT_CHECKIN_SETTINGS: CheckinSettings = {
  hour: 21,
  minute: 0,
  weekdays: [],
  muted: false,
};

function scheduleIdFor(weekday?: number): string {
  return weekday ? `${CHECKIN_SCHEDULE_ID}-wd${weekday}` : CHECKIN_SCHEDULE_ID;
}

function allScheduleIds(): string[] {
  return [CHECKIN_SCHEDULE_ID, ...[1, 2, 3, 4, 5, 6, 7].map(scheduleIdFor)];
}

/**
 * Creates (or updates) the dedicated check-in channel. Muting drops the
 * channel importance to NONE so reminders stay scheduled but silent.
 */
export async function ensureCheckinChannel(muted: boolean): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHECKIN_CHANNEL_ID, {
      name: 'Vela Daily Check-in',
      importance: muted
        ? Notifications.AndroidImportance.NONE
        : Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#FF6FC4CD',
    });
  } catch (e) {
    console.warn('[checkIn] Failed to create check-in channel', e);
  }
}

export async function loadCheckinSettings(): Promise<CheckinSettings> {
  try {
    const raw = await AsyncStorage.getItem(CHECKIN_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_CHECKIN_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      hour: typeof parsed.hour === 'number' ? parsed.hour : DEFAULT_CHECKIN_SETTINGS.hour,
      minute: typeof parsed.minute === 'number' ? parsed.minute : DEFAULT_CHECKIN_SETTINGS.minute,
      weekdays: Array.isArray(parsed.weekdays) ? parsed.weekdays : [],
      muted: !!parsed.muted,
    };
  } catch {
    return { ...DEFAULT_CHECKIN_SETTINGS };
  }
}

export async function saveCheckinSettings(settings: CheckinSettings): Promise<void> {
  await AsyncStorage.setItem(CHECKIN_SETTINGS_KEY, JSON.stringify(settings));
}

async function notificationsAllowed(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function cancelDailyCheckin(): Promise<void> {
  for (const id of allScheduleIds()) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Already gone — nothing to do.
    }
  }
}

/**
 * Schedules the daily check-in reminder with a CALENDAR trigger at the
 * user's chosen time. Reschedules (cancels first) so changes apply cleanly.
 * Returns the schedule ids, or [] when notifications are not granted.
 */
export async function scheduleDailyCheckin(settings: CheckinSettings): Promise<string[]> {
  if (!(await notificationsAllowed())) {
    return [];
  }
  await cancelDailyCheckin();
  const weekdays = settings.weekdays.length > 0 ? settings.weekdays : [undefined];
  const ids: string[] = [];
  for (const weekday of weekdays) {
    const identifier = scheduleIdFor(weekday);
    try {
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: 'Daily check-in 🌙',
          body: 'How was today? Tap to check in — one win, one thing you are carrying.',
          data: { type: 'checkin', route: CHECKIN_DEEP_LINK },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          channelId: CHECKIN_CHANNEL_ID,
          hour: settings.hour,
          minute: settings.minute,
          ...(weekday ? { weekday } : {}),
          repeats: true,
        },
      });
      ids.push(identifier);
    } catch (e) {
      console.warn('[checkIn] Failed to schedule check-in reminder', e);
    }
  }
  return ids;
}

/**
 * Applies check-in settings end to end: persists them, refreshes the
 * channel (mute switch), and reschedules the reminder. Muting keeps the
 * schedule but silences the channel; unmuting restores HIGH importance.
 */
export async function applyCheckinSettings(settings: CheckinSettings): Promise<string[]> {
  await saveCheckinSettings(settings);
  await ensureCheckinChannel(settings.muted);
  return scheduleDailyCheckin(settings);
}

jest.mock('expo-notifications', () => ({
  AndroidImportance: { NONE: 0, DEFAULT: 3, HIGH: 4, MAX: 5 },
  SchedulableTriggerInputTypes: { CALENDAR: 'calendar' },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  CHECKIN_CHANNEL_ID,
  applyCheckinSettings,
  ensureCheckinChannel,
  loadCheckinSettings,
  scheduleDailyCheckin,
} from '../utils/checkIn';
import { parseUrl } from '../utils/notificationRouting';

const mocks = Notifications as unknown as {
  setNotificationChannelAsync: jest.Mock;
  getPermissionsAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
};

describe('check-in settings + local notification scheduling (wayfinder #118)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await AsyncStorage.clear();
  });

  it('schedules a CALENDAR trigger at the chosen time that reschedules on change', async () => {
    const ids = await scheduleDailyCheckin({ hour: 21, minute: 30, weekdays: [], muted: false });

    expect(ids).toEqual(['vela-daily-checkin']);
    expect(mocks.cancelScheduledNotificationAsync).toHaveBeenCalled();
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [args] = mocks.scheduleNotificationAsync.mock.calls[0];
    expect(args.identifier).toBe('vela-daily-checkin');
    expect(args.trigger).toMatchObject({
      type: 'calendar',
      channelId: CHECKIN_CHANNEL_ID,
      hour: 21,
      minute: 30,
      repeats: true,
    });
    expect(args.content.data).toMatchObject({ type: 'checkin' });
  });

  it('schedules one trigger per weekday when a pattern is set', async () => {
    const ids = await scheduleDailyCheckin({ hour: 8, minute: 0, weekdays: [2, 4], muted: false });

    expect(ids).toHaveLength(2);
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const triggers = mocks.scheduleNotificationAsync.mock.calls.map(([a]) => a.trigger);
    expect(triggers).toMatchObject([{ weekday: 2 }, { weekday: 4 }]);
  });

  it('does not schedule when notifications are not granted', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const ids = await scheduleDailyCheckin({ hour: 21, minute: 0, weekdays: [], muted: false });

    expect(ids).toEqual([]);
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('mutes via channel importance NONE and unmutes via HIGH', async () => {
    await ensureCheckinChannel(true);
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      CHECKIN_CHANNEL_ID,
      expect.objectContaining({ importance: 0 })
    );

    await ensureCheckinChannel(false);
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      CHECKIN_CHANNEL_ID,
      expect.objectContaining({ importance: 4 })
    );
  });

  it('applyCheckinSettings persists and reschedules', async () => {
    const ids = await applyCheckinSettings({ hour: 7, minute: 15, weekdays: [], muted: true });

    expect(ids).toEqual(['vela-daily-checkin']);
    const stored = await AsyncStorage.getItem('vela.checkin.settings');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toMatchObject({ hour: 7, minute: 15, muted: true });
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalled();
  });

  it('loads defaults when nothing is stored', async () => {
    const settings = await loadCheckinSettings();
    expect(settings).toMatchObject({ hour: 21, minute: 0, weekdays: [], muted: false });
  });

  it('parses the vela-client://checkin deep link to chat home', () => {
    expect(parseUrl('vela-client://checkin')).toEqual({ type: 'checkin', route: '/' });
  });
});

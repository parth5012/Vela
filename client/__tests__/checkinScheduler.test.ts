jest.mock('../db/client', () => {
  const mockSelect = jest.fn();
  const mockInsert = jest.fn();
  const mockDelete = jest.fn();
  const mockUpdate = jest.fn();

  return {
    __esModule: true,
    db: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
    },
    initializeDatabase: jest.fn(),
    expoDb: {},
    default: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
    },
  };
});

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

import { db } from '../db/client';
import * as Notifications from 'expo-notifications';
import {
  CHECKIN_TASK_KIND,
  NUDGE_TASK_ID,
  WEEKLY_TASK_ID,
  NUDGE_PROMPT,
  WEEKLY_PROMPT,
  localDateString,
  yesterdayDateString,
  isCheckinSchedulerTask,
  isUserVisibleTask,
  ensureCheckinSchedulerTasks,
  gateCheckinTask,
  presentCheckinNotification,
} from '../utils/checkinScheduler';

const notifMocks = Notifications as unknown as {
  scheduleNotificationAsync: jest.Mock;
};

describe('check-in scheduler rows (wayfinder #119)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('date helpers', () => {
    it('formats local YYYY-MM-DD and derives yesterday', () => {
      expect(localDateString(new Date(2026, 8, 17, 12, 0, 0))).toBe('2026-09-17');
      expect(yesterdayDateString(new Date(2026, 8, 17, 12, 0, 0))).toBe('2026-09-16');
    });
  });

  describe('kind discriminator', () => {
    it('marks scheduler rows and hides them from the user task list', () => {
      expect(isCheckinSchedulerTask({ description: CHECKIN_TASK_KIND })).toBe(true);
      expect(isCheckinSchedulerTask({ description: 'my own task' })).toBe(false);
      expect(isUserVisibleTask({ description: CHECKIN_TASK_KIND })).toBe(false);
      expect(isUserVisibleTask({ description: 'my own task' })).toBe(true);
    });

    it('uses vela:checkin as the discriminator', () => {
      expect(CHECKIN_TASK_KIND).toBe('vela:checkin');
    });
  });

  describe('ensureCheckinSchedulerTasks', () => {
    function mockSelectWhere(rows: unknown[]) {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: () => ({ where: async () => rows }),
      });
    }

    it('seeds the nudge + weekly rows with the approved prompts and agents', async () => {
      mockSelectWhere([]);
      mockSelectWhere([]);
      const valuesFn = jest.fn(async () => undefined);
      (db.insert as jest.Mock).mockReturnValue({ values: valuesFn });

      await ensureCheckinSchedulerTasks();

      expect(valuesFn).toHaveBeenCalledTimes(2);
      const rows = valuesFn.mock.calls.map((call: unknown[]) => call[0] as { id: string; task_prompt: string });
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[NUDGE_TASK_ID]).toMatchObject({
        description: CHECKIN_TASK_KIND,
        recurrence_rule: '24h',
        linked_agent: 'check-in',
      });
      expect(byId[NUDGE_TASK_ID].task_prompt).toBe(NUDGE_PROMPT);
      expect(byId[WEEKLY_TASK_ID]).toMatchObject({
        description: CHECKIN_TASK_KIND,
        recurrence_rule: 'weekly',
        linked_agent: 'analyst',
      });
      expect(byId[WEEKLY_TASK_ID].task_prompt).toBe(WEEKLY_PROMPT);
    });

    it('is idempotent: skips rows that already exist', async () => {
      mockSelectWhere([{ id: NUDGE_TASK_ID }]);
      mockSelectWhere([{ id: WEEKLY_TASK_ID }]);
      const valuesFn = jest.fn(async () => undefined);
      (db.insert as jest.Mock).mockReturnValue({ values: valuesFn });

      await ensureCheckinSchedulerTasks();

      expect(valuesFn).not.toHaveBeenCalled();
    });
  });

  describe('gateCheckinTask', () => {
    const NOW = new Date(2026, 8, 17, 9, 0, 0); // 2026-09-17 morning run

    it('fires the nudge only when yesterday has no entry', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: () => ({ where: async () => [] }),
      });
      await expect(gateCheckinTask(NUDGE_TASK_ID, NOW)).resolves.toMatchObject({ fire: true });

      (db.select as jest.Mock).mockReturnValueOnce({
        from: () => ({ where: async () => [{ date: '2026-09-16' }] }),
      });
      await expect(gateCheckinTask(NUDGE_TASK_ID, NOW)).resolves.toMatchObject({ fire: false });
    });

    it('suppresses the weekly reflection when the week has zero entries', async () => {
      (db.select as jest.Mock).mockReturnValueOnce({
        from: async () => [{ date: '2026-08-01' }],
      });
      await expect(gateCheckinTask(WEEKLY_TASK_ID, NOW)).resolves.toMatchObject({ fire: false });

      (db.select as jest.Mock).mockReturnValueOnce({
        from: async () => [{ date: '2026-09-15' }],
      });
      await expect(gateCheckinTask(WEEKLY_TASK_ID, NOW)).resolves.toMatchObject({ fire: true });
    });
  });

  describe('presentCheckinNotification', () => {
    it('presents a tap-to-chat notification', async () => {
      await presentCheckinNotification('vela-checkin-nudge-note', 'Gentle nudge 🌱', 'hello');

      expect(notifMocks.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      const [args] = notifMocks.scheduleNotificationAsync.mock.calls[0];
      expect(args.identifier).toBe('vela-checkin-nudge-note');
      expect(args.content.data).toMatchObject({ type: 'checkin' });
    });
  });
});

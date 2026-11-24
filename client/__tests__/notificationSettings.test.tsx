import React from 'react';
import renderer, { act } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import {
  useNotificationStore,
  DEFAULT_QUIET_HOURS,
  DEFAULT_CHANNELS,
} from '../store/useNotificationStore';
import {
  normalizeChannelKey,
  isWithinQuietHours,
  getNextQuietHoursEnd,
  evaluateNotificationDelivery,
  scheduleGatedNotification,
  handleForegroundNotification,
  cancelDeferredNotifications,
} from '../utils/notificationGate';
import { parseUrl, routeByType } from '../utils/notificationRouting';
import NotificationsSettingsScreen, { TimeStepper } from '../app/settings/notifications';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    navigate: jest.fn(),
    back: jest.fn(),
  }),
}));

describe('Notification Settings & Gating (#604, #607)', () => {
  beforeEach(() => {
    act(() => {
      useNotificationStore.getState().resetToDefaults();
    });
    jest.clearAllMocks();
  });

  describe('useNotificationStore', () => {
    it('initializes with verified defaults (disabled quiet hours, 22:00-07:00, all 5 channels enabled)', () => {
      const state = useNotificationStore.getState();
      expect(state.quietHours).toEqual(DEFAULT_QUIET_HOURS);
      expect(state.quietHours.enabled).toBe(false);
      expect(state.quietHours.startHour).toBe(22);
      expect(state.quietHours.startMinute).toBe(0);
      expect(state.quietHours.endHour).toBe(7);
      expect(state.quietHours.endMinute).toBe(0);

      expect(state.channels).toEqual(DEFAULT_CHANNELS);
      expect(state.channels.task_completion).toBe(true);
      expect(state.channels.calendar_reminder).toBe(true);
      expect(state.channels.briefing).toBe(true);
      expect(state.channels.checkin).toBe(true);
      expect(state.channels.approval).toBe(true);
    });

    it('updates quiet hours configuration with validation & clamping', () => {
      act(() => {
        useNotificationStore.getState().setQuietHours({
          enabled: true,
          startHour: 99, // Clamped to 23
          startMinute: -5, // Clamped to 0
          endHour: 8,
          endMinute: 75, // Clamped to 59
        });
      });

      const updated = useNotificationStore.getState().quietHours;
      expect(updated.enabled).toBe(true);
      expect(updated.startHour).toBe(23);
      expect(updated.startMinute).toBe(0);
      expect(updated.endHour).toBe(8);
      expect(updated.endMinute).toBe(59);
    });

    it('tracks and clears deferred notification IDs on reset', async () => {
      act(() => {
        useNotificationStore.getState().trackDeferredNotificationId('notif-1');
        useNotificationStore.getState().trackDeferredNotificationId('notif-2');
      });

      expect(useNotificationStore.getState().deferredNotificationIds).toEqual(['notif-1', 'notif-2']);

      await act(async () => {
        await cancelDeferredNotifications();
      });

      expect(useNotificationStore.getState().deferredNotificationIds).toEqual([]);
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-2');
    });

    it('toggles individual channels', () => {
      act(() => {
        useNotificationStore.getState().setChannelEnabled('briefing', false);
        useNotificationStore.getState().setChannelEnabled('task_completion', false);
      });

      const channels = useNotificationStore.getState().channels;
      expect(channels.briefing).toBe(false);
      expect(channels.task_completion).toBe(false);
      expect(channels.calendar_reminder).toBe(true);
      expect(channels.checkin).toBe(true);
      expect(channels.approval).toBe(true);
    });

    it('resets to verified defaults', () => {
      act(() => {
        useNotificationStore.getState().setQuietHours({ enabled: true, startHour: 1 });
        useNotificationStore.getState().setChannelEnabled('approval', false);
        useNotificationStore.getState().resetToDefaults();
      });

      expect(useNotificationStore.getState().quietHours).toEqual(DEFAULT_QUIET_HOURS);
      expect(useNotificationStore.getState().channels).toEqual(DEFAULT_CHANNELS);
    });
  });

  describe('normalizeChannelKey', () => {
    it('normalizes canonical channel names and aliases', () => {
      expect(normalizeChannelKey('task_completion')).toBe('task_completion');
      expect(normalizeChannelKey('vela_task_completion')).toBe('task_completion');
      expect(normalizeChannelKey('calendar_reminder')).toBe('calendar_reminder');
      expect(normalizeChannelKey('vela_calendar_reminders')).toBe('calendar_reminder');
      expect(normalizeChannelKey('briefing')).toBe('briefing');
      expect(normalizeChannelKey('vela_briefing')).toBe('briefing');
      expect(normalizeChannelKey('checkin')).toBe('checkin');
      expect(normalizeChannelKey('vela_checkin')).toBe('checkin');
      expect(normalizeChannelKey('approval')).toBe('approval');
      expect(normalizeChannelKey('approval_needed')).toBe('approval');
      expect(normalizeChannelKey('vela_approval')).toBe('approval');
    });

    it('returns null for unknown or empty types', () => {
      expect(normalizeChannelKey(null)).toBeNull();
      expect(normalizeChannelKey('')).toBeNull();
      expect(normalizeChannelKey('unknown_random_event')).toBeNull();
    });
  });

  describe('isWithinQuietHours', () => {
    it('returns false when quiet hours is disabled', () => {
      const config = { enabled: false, startHour: 22, startMinute: 0, endHour: 7, endMinute: 0 };
      const date = new Date(2026, 10, 24, 23, 0); // 11 PM
      expect(isWithinQuietHours(date, config)).toBe(false);
    });

    it('returns false when start and end times are identical (0-duration window)', () => {
      const config = { enabled: true, startHour: 22, startMinute: 0, endHour: 22, endMinute: 0 };
      expect(isWithinQuietHours(new Date(2026, 10, 24, 22, 0), config)).toBe(false);
    });

    it('correctly handles overnight cross-midnight window (22:00 to 07:00)', () => {
      const config = { enabled: true, startHour: 22, startMinute: 0, endHour: 7, endMinute: 0 };

      // Before start time
      expect(isWithinQuietHours(new Date(2026, 10, 24, 21, 59), config)).toBe(false);
      expect(isWithinQuietHours(new Date(2026, 10, 24, 14, 0), config)).toBe(false);

      // At start time
      expect(isWithinQuietHours(new Date(2026, 10, 24, 22, 0), config)).toBe(true);

      // Late night (same calendar day)
      expect(isWithinQuietHours(new Date(2026, 10, 24, 23, 45), config)).toBe(true);

      // Midnight & early morning (next calendar day)
      expect(isWithinQuietHours(new Date(2026, 10, 25, 0, 0), config)).toBe(true);
      expect(isWithinQuietHours(new Date(2026, 10, 25, 3, 30), config)).toBe(true);
      expect(isWithinQuietHours(new Date(2026, 10, 25, 6, 59), config)).toBe(true);

      // At end time
      expect(isWithinQuietHours(new Date(2026, 10, 25, 7, 0), config)).toBe(false);
      expect(isWithinQuietHours(new Date(2026, 10, 25, 7, 1), config)).toBe(false);
    });

    it('correctly handles same-day window (09:00 to 17:00)', () => {
      const config = { enabled: true, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 };

      expect(isWithinQuietHours(new Date(2026, 10, 24, 8, 59), config)).toBe(false);
      expect(isWithinQuietHours(new Date(2026, 10, 24, 9, 0), config)).toBe(true);
      expect(isWithinQuietHours(new Date(2026, 10, 24, 13, 0), config)).toBe(true);
      expect(isWithinQuietHours(new Date(2026, 10, 24, 16, 59), config)).toBe(true);
      expect(isWithinQuietHours(new Date(2026, 10, 24, 17, 0), config)).toBe(false);
      expect(isWithinQuietHours(new Date(2026, 10, 24, 20, 0), config)).toBe(false);
    });
  });

  describe('getNextQuietHoursEnd', () => {
    it('returns next morning for late night in overnight window', () => {
      const config = { enabled: true, startHour: 22, startMinute: 0, endHour: 7, endMinute: 0 };
      const from = new Date(2026, 10, 24, 23, 30); // Nov 24, 23:30
      const nextEnd = getNextQuietHoursEnd(from, config);

      expect(nextEnd.getFullYear()).toBe(2026);
      expect(nextEnd.getMonth()).toBe(10);
      expect(nextEnd.getDate()).toBe(25); // Nov 25
      expect(nextEnd.getHours()).toBe(7);
      expect(nextEnd.getMinutes()).toBe(0);
    });

    it('returns same morning for early morning hours in overnight window', () => {
      const config = { enabled: true, startHour: 22, startMinute: 0, endHour: 7, endMinute: 0 };
      const from = new Date(2026, 10, 25, 3, 15); // Nov 25, 03:15
      const nextEnd = getNextQuietHoursEnd(from, config);

      expect(nextEnd.getFullYear()).toBe(2026);
      expect(nextEnd.getMonth()).toBe(10);
      expect(nextEnd.getDate()).toBe(25); // Nov 25
      expect(nextEnd.getHours()).toBe(7);
      expect(nextEnd.getMinutes()).toBe(0);
    });

    it('returns immediately when start and end are equal', () => {
      const config = { enabled: true, startHour: 22, startMinute: 0, endHour: 22, endMinute: 0 };
      const from = new Date(2026, 10, 24, 22, 0);
      const nextEnd = getNextQuietHoursEnd(from, config);
      expect(nextEnd.getTime()).toBe(from.getTime());
    });
  });

  describe('evaluateNotificationDelivery', () => {
    it('suppresses delivery when channel is disabled', () => {
      act(() => {
        useNotificationStore.getState().setChannelEnabled('checkin', false);
      });

      const evalResult = evaluateNotificationDelivery('checkin');
      expect(evalResult.shouldDeliver).toBe(false);
      expect(evalResult.isDeferred).toBe(false);
      expect(evalResult.channel).toBe('checkin');
    });

    it('allows immediate delivery when channel is enabled and outside quiet hours', () => {
      const daytime = new Date(2026, 10, 24, 14, 0);
      const evalResult = evaluateNotificationDelivery('briefing', daytime);
      expect(evalResult.shouldDeliver).toBe(true);
      expect(evalResult.isDeferred).toBe(false);
      expect(evalResult.deferredDate).toBeUndefined();
    });

    it('defers delivery when channel is enabled and inside quiet hours', () => {
      act(() => {
        useNotificationStore.getState().setQuietHours({
          enabled: true,
          startHour: 22,
          startMinute: 0,
          endHour: 7,
          endMinute: 0,
        });
      });

      const nightTime = new Date(2026, 10, 24, 23, 30);
      const evalResult = evaluateNotificationDelivery('task_completion', nightTime);
      expect(evalResult.shouldDeliver).toBe(true);
      expect(evalResult.isDeferred).toBe(true);
      expect(evalResult.deferredDate).toBeDefined();
      expect(evalResult.deferredDate?.getHours()).toBe(7);
      expect(evalResult.deferredDate?.getDate()).toBe(25);
    });

    it('pre-approves and immediately delivers when already deferred', () => {
      act(() => {
        useNotificationStore.getState().setQuietHours({
          enabled: true,
          startHour: 22,
          startMinute: 0,
          endHour: 7,
          endMinute: 0,
        });
      });

      const nightTime = new Date(2026, 10, 24, 23, 30);
      const evalResult = evaluateNotificationDelivery('task_completion', nightTime, true);
      expect(evalResult.shouldDeliver).toBe(true);
      expect(evalResult.isDeferred).toBe(false);
      expect(evalResult.reason).toBe('pre_approved_deferred_delivery');
    });
  });

  describe('scheduleGatedNotification', () => {
    it('drops notification when channel is disabled', async () => {
      act(() => {
        useNotificationStore.getState().setChannelEnabled('calendar_reminder', false);
      });

      const res = await scheduleGatedNotification({
        channel: 'calendar_reminder',
        title: 'Meeting in 10 mins',
        body: 'Sync call',
      });

      expect(res.delivered).toBe(false);
      expect(res.deferred).toBe(false);
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('schedules immediate notification when outside quiet hours', async () => {
      const daytime = new Date(2026, 10, 24, 12, 0);
      const res = await scheduleGatedNotification({
        channel: 'task_completion',
        title: 'Task finished',
        body: 'All steps done',
        targetDate: daytime,
      });

      expect(res.delivered).toBe(true);
      expect(res.deferred).toBe(false);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Task finished',
            body: 'All steps done',
          }),
          trigger: null,
        })
      );
    });

    it('schedules deferred notification with Date trigger during quiet hours and tracks ID', async () => {
      act(() => {
        useNotificationStore.getState().setQuietHours({
          enabled: true,
          startHour: 22,
          startMinute: 0,
          endHour: 7,
          endMinute: 0,
        });
      });

      const nightTime = new Date(2026, 10, 24, 23, 30);
      const res = await scheduleGatedNotification({
        channel: 'approval',
        title: 'Approval request',
        body: 'Confirm action',
        targetDate: nightTime,
      });

      expect(res.delivered).toBe(true);
      expect(res.deferred).toBe(true);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Approval request',
            data: expect.objectContaining({ deferred: true }),
          }),
          trigger: expect.objectContaining({
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: expect.any(Date),
          }),
        })
      );
      expect(useNotificationStore.getState().deferredNotificationIds).toContain('mock-notification-id');
    });
  });

  describe('Deep Linking & Routing (#604, #607)', () => {
    it('parses vela-client://settings/notifications URL correctly', () => {
      const parsed = parseUrl('vela-client://settings/notifications');
      expect(parsed).toEqual({
        type: 'settings',
        route: '/settings/notifications',
      });
    });

    it('routes settings type to the target settings route', () => {
      const mockReplace = jest.fn();
      const mockSelectThread = jest.fn();

      routeByType(
        { type: 'settings', route: '/settings/notifications' },
        { replace: mockReplace },
        mockSelectThread
      );

      expect(mockReplace).toHaveBeenCalledWith('/settings/notifications');
      expect(mockSelectThread).not.toHaveBeenCalled();
    });
  });

  describe('NotificationsSettingsScreen UI Component', () => {
    it('renders without crashing and displays all sections, channel toggles, and accessible labels', () => {
      let root: renderer.ReactTestRenderer | null = null;
      act(() => {
        root = renderer.create(<NotificationsSettingsScreen />);
      });

      expect(root).not.toBeNull();
      const textNodes = root!.root.findAllByType('Text' as any).map((n) => n.props.children);
      const flattened = textNodes.flat(Infinity).join(' ');

      // Section titles
      expect(flattened).toContain('Quiet Hours');
      expect(flattened).toContain('Notification Channels');

      // Channels
      expect(flattened).toContain('Task Updates');
      expect(flattened).toContain('Calendar Alerts');
      expect(flattened).toContain('Morning Briefing');
      expect(flattened).toContain('Daily Check-in');
      expect(flattened).toContain('Action Approvals');
    });
  });

  describe('handleForegroundNotification', () => {
    it('presents immediately when outside quiet hours', async () => {
      const notification = {
        request: {
          identifier: 'test-1',
          content: {
            title: 'Task Done',
            body: 'Finished downloading',
            data: { type: 'task_completion' },
          },
        },
      } as any;

      const behavior = await handleForegroundNotification(notification);
      expect(behavior.shouldShowAlert).toBe(true);
      expect(behavior.shouldPlaySound).toBe(true);
    });

    it('defers delivery with Date trigger when quiet hours are active', async () => {
      act(() => {
        useNotificationStore.getState().setQuietHours({
          enabled: true,
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59,
        });
      });

      const notification = {
        request: {
          identifier: 'test-quiet',
          content: {
            title: 'Quiet Notification',
            body: 'Should be deferred',
            data: { type: 'task_completion' },
          },
        },
      } as any;

      const behavior = await handleForegroundNotification(notification);
      expect(behavior.shouldShowAlert).toBe(false);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'deferred-test-quiet',
          content: expect.objectContaining({
            data: expect.objectContaining({ deferred: true }),
          }),
          trigger: expect.objectContaining({
            type: Notifications.SchedulableTriggerInputTypes.DATE,
          }),
        })
      );
    });

    it('presents pre-approved deferred notifications immediately', async () => {
      act(() => {
        useNotificationStore.getState().setQuietHours({
          enabled: true,
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59,
        });
      });

      const notification = {
        request: {
          identifier: 'deferred-123',
          content: {
            title: 'Re-delivered notification',
            body: 'Firing after quiet hours',
            data: { type: 'task_completion', deferred: true },
          },
        },
      } as any;

      const behavior = await handleForegroundNotification(notification);
      expect(behavior.shouldShowAlert).toBe(true);
      expect(behavior.shouldPlaySound).toBe(true);
    });

    it('suppresses presentation when channel is disabled', async () => {
      act(() => {
        useNotificationStore.getState().setChannelEnabled('briefing', false);
      });

      const notification = {
        request: {
          identifier: 'test-briefing',
          content: {
            title: 'Morning Briefing',
            body: 'Here is your update',
            data: { type: 'briefing' },
          },
        },
      } as any;

      const behavior = await handleForegroundNotification(notification);
      expect(behavior.shouldShowAlert).toBe(false);
    });
  });

  describe('TimeStepper hour and minute wrapping', () => {
    it('borrows an hour when decrementing from minute 0', () => {
      const mockChange = jest.fn();
      let root: renderer.ReactTestRenderer | null = null;
      act(() => {
        root = renderer.create(
          <TimeStepper
            label="Start Time"
            hour={22}
            minute={0}
            onChange={mockChange}
          />
        );
      });

      const decMinuteBtn = root!.root.findByProps({
        accessibilityLabel: 'Decrease Start Time minute',
      });
      act(() => {
        decMinuteBtn.props.onPress();
      });

      // Hour borrows: 22 -> 21, minute -> 45
      expect(mockChange).toHaveBeenCalledWith(21, 45);
    });

    it('increments hour when advancing past minute 45', () => {
      const mockChange = jest.fn();
      let root: renderer.ReactTestRenderer | null = null;
      act(() => {
        root = renderer.create(
          <TimeStepper
            label="End Time"
            hour={22}
            minute={45}
            onChange={mockChange}
          />
        );
      });

      const incMinuteBtn = root!.root.findByProps({
        accessibilityLabel: 'Increase End Time minute',
      });
      act(() => {
        incMinuteBtn.props.onPress();
      });

      // Hour advances: 22 -> 23, minute -> 0
      expect(mockChange).toHaveBeenCalledWith(23, 0);
    });
  });

  describe('cancelDeferredNotifications', () => {
    it('cancels all tracked deferred notification IDs and clears the registry', async () => {
      act(() => {
        useNotificationStore.getState().trackDeferredNotificationId('def-1');
        useNotificationStore.getState().trackDeferredNotificationId('def-2');
      });

      expect(useNotificationStore.getState().deferredNotificationIds).toEqual(['def-1', 'def-2']);

      await cancelDeferredNotifications();

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('def-1');
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('def-2');
      expect(useNotificationStore.getState().deferredNotificationIds).toEqual([]);
    });
  });
});

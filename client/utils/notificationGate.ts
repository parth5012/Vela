import * as Notifications from 'expo-notifications';
import {
  useNotificationStore,
  type NotificationChannelKey,
  type QuietHoursConfig,
} from '../store/useNotificationStore';

/**
 * Normalizes an arbitrary notification string or FCM type identifier
 * to one of the canonical 5 NotificationChannelKeys, or returns null if unrecognized.
 */
export function normalizeChannelKey(rawType?: string | null): NotificationChannelKey | null {
  if (!rawType) return null;
  const cleaned = rawType.trim().toLowerCase();
  switch (cleaned) {
    case 'task_completion':
    case 'vela_task_completion':
      return 'task_completion';
    case 'calendar_reminder':
    case 'vela_calendar_reminders':
      return 'calendar_reminder';
    case 'briefing':
    case 'vela_briefing':
      return 'briefing';
    case 'checkin':
    case 'vela_checkin':
      return 'checkin';
    case 'approval':
    case 'approval_needed':
    case 'vela_approval':
      return 'approval';
    default:
      return null;
  }
}

/**
 * Checks if a given Date falls within the configured quiet hours window.
 * Handles both same-day windows (e.g. 13:00 to 17:00) and cross-midnight windows (e.g. 22:00 to 07:00).
 */
export function isWithinQuietHours(date: Date, config: QuietHoursConfig): boolean {
  if (!config.enabled) return false;

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes = config.startHour * 60 + config.startMinute;
  const endMinutes = config.endHour * 60 + config.endMinute;

  if (startMinutes === endMinutes) {
    // 0-minute duration window: effectively disabled
    return false;
  }

  if (startMinutes < endMinutes) {
    // Same-day window (e.g. 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Cross-midnight window (e.g. 22:00 - 07:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Calculates the exact next Date timestamp when quiet hours end.
 */
export function getNextQuietHoursEnd(from: Date, config: QuietHoursConfig): Date {
  const result = new Date(from);
  result.setHours(config.endHour, config.endMinute, 0, 0);

  const currentMinutes = from.getHours() * 60 + from.getMinutes();
  const startMinutes = config.startHour * 60 + config.startMinute;
  const endMinutes = config.endHour * 60 + config.endMinute;

  if (startMinutes < endMinutes) {
    // Same-day window
    if (currentMinutes >= endMinutes) {
      // Already past end today, rolls over to tomorrow
      result.setDate(result.getDate() + 1);
    }
  } else {
    // Overnight window (e.g. 22:00 to 07:00)
    // If we are before midnight (e.g. 23:00 >= startMinutes), end occurs tomorrow at endHour
    // If we are after midnight (e.g. 03:00 < endMinutes), end occurs today at endHour
    if (currentMinutes >= startMinutes) {
      result.setDate(result.getDate() + 1);
    }
  }

  return result;
}

export interface DeliveryEvaluation {
  shouldDeliver: boolean;
  isDeferred: boolean;
  deferredDate?: Date;
  channel?: NotificationChannelKey;
  reason: string;
}

/**
 * Evaluates whether a notification of the given type/channel should be delivered immediately,
 * deferred until the end of quiet hours, or dropped because the channel is disabled.
 */
export function evaluateNotificationDelivery(
  rawType?: string | null,
  targetDate: Date = new Date()
): DeliveryEvaluation {
  const channel = normalizeChannelKey(rawType);
  const { channels, quietHours } = useNotificationStore.getState();

  // If unrecognized type, default to allow delivery unless quiet hours are active
  if (channel && channels[channel] === false) {
    return {
      shouldDeliver: false,
      isDeferred: false,
      channel,
      reason: `channel_${channel}_disabled`,
    };
  }

  if (quietHours.enabled && isWithinQuietHours(targetDate, quietHours)) {
    const deferredDate = getNextQuietHoursEnd(targetDate, quietHours);
    return {
      shouldDeliver: true,
      isDeferred: true,
      deferredDate,
      channel: channel ?? undefined,
      reason: 'deferred_due_to_quiet_hours',
    };
  }

  return {
    shouldDeliver: true,
    isDeferred: false,
    channel: channel ?? undefined,
    reason: 'immediate_delivery',
  };
}

export interface GatedNotificationRequest {
  identifier?: string;
  channel: NotificationChannelKey;
  title: string;
  body: string;
  data?: Record<string, any>;
  targetDate?: Date;
}

/**
 * Schedules a notification through the quiet hours and per-channel gating pipeline.
 * - If channel is disabled: drops notification and returns { delivered: false, deferred: false }.
 * - If quiet hours are active: schedules delivery at the conclusion of quiet hours.
 * - Otherwise: schedules immediate delivery.
 */
export async function scheduleGatedNotification(
  req: GatedNotificationRequest
): Promise<{ delivered: boolean; deferred: boolean; id?: string }> {
  const evaluation = evaluateNotificationDelivery(req.channel, req.targetDate);

  if (!evaluation.shouldDeliver) {
    console.log(`[notificationGate] Suppressed notification for channel: ${req.channel}`);
    return { delivered: false, deferred: false };
  }

  const payloadData = {
    ...(req.data ?? {}),
    channel: req.channel,
    ...(evaluation.isDeferred ? { deferred: true, originalTime: new Date().toISOString() } : {}),
  };

  try {
    const identifier = req.identifier;
    let scheduledId: string;

    if (evaluation.isDeferred && evaluation.deferredDate) {
      console.log(
        `[notificationGate] Deferring notification (${req.channel}) to ${evaluation.deferredDate.toISOString()}`
      );
      scheduledId = await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: req.title,
          body: req.body,
          data: payloadData,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: evaluation.deferredDate,
        },
      });
      return { delivered: true, deferred: true, id: scheduledId };
    }

    scheduledId = await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: req.title,
        body: req.body,
        data: payloadData,
      },
      trigger: null,
    });
    return { delivered: true, deferred: false, id: scheduledId };
  } catch (error) {
    console.warn('[notificationGate] Failed to schedule notification:', error);
    return { delivered: false, deferred: false };
  }
}

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
  const currentMinutes = from.getHours() * 60 + from.getMinutes();
  const startMinutes = config.startHour * 60 + config.startMinute;
  const endMinutes = config.endHour * 60 + config.endMinute;

  if (startMinutes === endMinutes) {
    // 0-duration window: end is immediate
    return new Date(from);
  }

  let dayOffset = 0;
  if (startMinutes < endMinutes) {
    // Same-day window (e.g. 09:00 to 17:00)
    if (currentMinutes >= endMinutes) {
      // Already past end today, rolls over to tomorrow
      dayOffset = 1;
    }
  } else {
    // Overnight window (e.g. 22:00 to 07:00)
    // If we are before midnight (e.g. 23:00 >= startMinutes), end occurs tomorrow at endHour
    // If we are after midnight (e.g. 03:00 < endMinutes), end occurs today at endHour
    if (currentMinutes >= startMinutes) {
      dayOffset = 1;
    }
  }

  const result = new Date(from);
  if (dayOffset > 0) {
    result.setDate(result.getDate() + dayOffset);
  }
  result.setHours(config.endHour, config.endMinute, 0, 0);

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
 *
 * If `isAlreadyDeferred` is true, it represents a scheduled deferred delivery that is now
 * firing, so it bypasses quiet hours and delivers immediately.
 */
export function evaluateNotificationDelivery(
  rawType?: string | null,
  targetDate: Date = new Date(),
  isAlreadyDeferred = false
): DeliveryEvaluation {
  const channel = normalizeChannelKey(rawType);
  const { channels, quietHours } = useNotificationStore.getState();

  // If already deferred and firing at the end of quiet hours, approve immediately
  if (isAlreadyDeferred) {
    return {
      shouldDeliver: true,
      isDeferred: false,
      channel: channel ?? undefined,
      reason: 'pre_approved_deferred_delivery',
    };
  }

  // If channel is disabled, drop it
  if (channel && channels[channel] === false) {
    return {
      shouldDeliver: false,
      isDeferred: false,
      channel,
      reason: `channel_${channel}_disabled`,
    };
  }

  // If quiet hours are active, defer delivery
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
  data?: Record<string, unknown>;
  targetDate?: Date;
}

/**
 * Schedules a notification through the quiet hours and per-channel gating pipeline.
 * - If channel is disabled: drops notification and returns { delivered: false, deferred: false }.
 * - If quiet hours are active: schedules delivery at the conclusion of quiet hours via Date trigger.
 * - Otherwise: schedules immediate delivery.
 */
export async function scheduleGatedNotification(
  req: GatedNotificationRequest
): Promise<{ delivered: boolean; deferred: boolean; id?: string }> {
  const isDeferredPayload = req.data?.deferred === true;
  const evaluation = evaluateNotificationDelivery(req.channel, req.targetDate, isDeferredPayload);

  if (!evaluation.shouldDeliver) {
    console.log(`[notificationGate] Suppressed notification for channel: ${req.channel}`);
    return { delivered: false, deferred: false };
  }

  const payloadData: Record<string, unknown> = {
    ...(req.data ?? {}),
    channel: req.channel,
    type: req.channel,
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
      useNotificationStore.getState().trackDeferredNotificationId(scheduledId);
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

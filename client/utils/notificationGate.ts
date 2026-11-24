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
 * Ensures the notification store has completed rehydration before gating decisions.
 */
export async function ensureNotificationStoreHydrated(): Promise<void> {
  const store = useNotificationStore;
  if (store.getState().hasHydrated) return;
  if (store.persist?.hasHydrated?.()) {
    store.getState().setHasHydrated(true);
    return;
  }
  try {
    await store.persist?.rehydrate?.();
  } catch {
    // fallback
  }
}

/**
 * Cancels all currently tracked deferred notifications and clears the ID registry.
 */
export async function cancelDeferredNotifications(): Promise<void> {
  const ids = useNotificationStore.getState().deferredNotificationIds;
  if (typeof Notifications.cancelScheduledNotificationAsync === 'function') {
    for (const id of ids) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // silent cleanup
      }
    }
  }
  useNotificationStore.getState().clearDeferredNotificationIds();
}

/**
 * Cancels any scheduled notifications belonging to a disabled channel.
 */
export async function cancelScheduledNotificationsForChannel(
  channel: NotificationChannelKey
): Promise<void> {
  if (typeof Notifications.getAllScheduledNotificationsAsync !== 'function') return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      const data = item.content?.data as Record<string, unknown> | undefined;
      const itemChannel = normalizeChannelKey((data?.channel as string) || (data?.type as string));
      if (itemChannel === channel && typeof Notifications.cancelScheduledNotificationAsync === 'function') {
        await Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[notificationGate] Failed to cancel scheduled notifications for channel:', err);
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
 * Self-defending against DST shifts and guarantees the returned date is in the future.
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
      dayOffset = 1;
    }
  } else {
    // Overnight window (e.g. 22:00 to 07:00)
    if (currentMinutes >= startMinutes) {
      dayOffset = 1;
    }
  }

  const result = new Date(from);
  if (dayOffset > 0) {
    result.setDate(result.getDate() + dayOffset);
  }
  result.setHours(config.endHour, config.endMinute, 0, 0);

  // Self-defense: ensure the result is strictly in the future relative to `from`
  if (result.getTime() <= from.getTime()) {
    result.setDate(result.getDate() + 1);
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
  const { channels, quietHours, hasHydrated } = useNotificationStore.getState();

  // If store has not hydrated yet, fail closed unless in test environment
  if (!hasHydrated && typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
    return {
      shouldDeliver: false,
      isDeferred: true,
      channel: channel ?? undefined,
      reason: 'store_not_hydrated',
    };
  }

  // If channel is disabled, drop it even if previously deferred
  if (channel && channels[channel] === false) {
    return {
      shouldDeliver: false,
      isDeferred: false,
      channel,
      reason: `channel_${channel}_disabled`,
    };
  }

  // If already deferred and firing at the end of quiet hours, approve immediately
  if (isAlreadyDeferred) {
    return {
      shouldDeliver: true,
      isDeferred: false,
      channel: channel ?? undefined,
      reason: 'pre_approved_deferred_delivery',
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
  channelId?: string;
  priority?: string;
  android?: Record<string, unknown>;
  trigger?: Notifications.NotificationTriggerInput;
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
  await ensureNotificationStoreHydrated();

  const isDeferredPayload = req.data?.deferred === true || req.data?.deferred === 'true';
  const evaluation = evaluateNotificationDelivery(req.channel, req.targetDate, isDeferredPayload);

  if (!evaluation.shouldDeliver) {
    console.log(`[notificationGate] Suppressed notification for channel: ${req.channel}`);
    return { delivered: false, deferred: false };
  }

  const payloadData: Record<string, unknown> = {
    ...(req.data ?? {}),
    channel: req.channel,
    type: (req.data?.type as string) || req.channel,
    ...(evaluation.isDeferred ? { deferred: true, originalTime: new Date().toISOString() } : {}),
  };

  const androidPayload = {
    ...(req.channelId ? { channelId: req.channelId } : {}),
    ...(req.android ?? {}),
    ...(req.priority && !req.android?.priority ? { priority: req.priority } : {}),
  };

  const content: Notifications.NotificationContentInput = {
    title: req.title,
    body: req.body,
    data: payloadData,
    ...(Object.keys(androidPayload).length > 0 ? { android: androidPayload } : {}),
  };

  try {
    const identifier = req.identifier;
    let scheduledId: string;

    if (evaluation.isDeferred && evaluation.deferredDate) {
      console.log(
        `[notificationGate] Deferring notification (${req.channel}) to ${evaluation.deferredDate.toISOString()}`
      );
      const dateType =
        Notifications.SchedulableTriggerInputTypes?.DATE ??
        ('date' as Notifications.SchedulableTriggerInputTypes.DATE);

      scheduledId = await Notifications.scheduleNotificationAsync({
        identifier,
        content,
        trigger: {
          type: dateType,
          date: evaluation.deferredDate,
          ...(req.channelId ? { channelId: req.channelId } : {}),
        },
      });
      useNotificationStore.getState().trackDeferredNotificationId(scheduledId);
      return { delivered: true, deferred: true, id: scheduledId };
    }

    const trigger = req.trigger ?? null;

    scheduledId = await Notifications.scheduleNotificationAsync({
      identifier,
      content,
      trigger,
    });
    return { delivered: true, deferred: false, id: scheduledId };
  } catch (error) {
    console.warn('[notificationGate] Failed to schedule notification:', error);
    return { delivered: false, deferred: false };
  }
}

/**
 * Handles incoming foreground notifications for Expo Notifications.setNotificationHandler.
 * Reschedules deferred notifications for the end of quiet hours.
 */
export async function handleForegroundNotification(
  notification: Notifications.Notification
): Promise<Notifications.NotificationBehavior> {
  await ensureNotificationStoreHydrated();

  const content = notification?.request?.content;
  const data = content?.data as Record<string, unknown> | undefined;
  const isAlreadyDeferred = data?.deferred === true || data?.deferred === 'true';
  const rawType = (data?.type as string) || (data?.channel as string);

  const evaluation = evaluateNotificationDelivery(rawType, new Date(), isAlreadyDeferred);

  if (!evaluation.shouldDeliver) {
    return {
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    };
  }

  if (isAlreadyDeferred) {
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  }

  if (evaluation.isDeferred && evaluation.deferredDate) {
    const channelId =
      ((content as { android?: { channelId?: string } })?.android?.channelId) ||
      (data?.channelId as string) ||
      (content as { channelId?: string })?.channelId;
    const androidConfig = (content as { android?: Record<string, unknown> })?.android;

    try {
      const dateType =
        Notifications.SchedulableTriggerInputTypes?.DATE ??
        ('date' as Notifications.SchedulableTriggerInputTypes.DATE);

      const scheduledId = await Notifications.scheduleNotificationAsync({
        identifier: notification.request.identifier
          ? `deferred-${notification.request.identifier}`
          : undefined,
        content: {
          title: content?.title || 'Notification',
          body: content?.body || '',
          data: { ...(data || {}), deferred: true, originalTime: new Date().toISOString() },
          ...(androidConfig ? { android: androidConfig } : {}),
        },
        trigger: {
          type: dateType,
          date: evaluation.deferredDate,
          ...(channelId ? { channelId } : {}),
        },
      });
      useNotificationStore.getState().trackDeferredNotificationId(scheduledId);
    } catch (err) {
      console.warn('[notificationGate] Failed to reschedule deferred notification:', err);
    }

    return {
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    };
  }

  return {
    shouldShowAlert: evaluation.shouldDeliver,
    shouldPlaySound: evaluation.shouldDeliver,
    shouldSetBadge: false,
    shouldShowBanner: evaluation.shouldDeliver,
    shouldShowList: evaluation.shouldDeliver,
  };
}

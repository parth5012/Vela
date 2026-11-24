import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

export type NotificationChannelKey =
  | 'task_completion'
  | 'calendar_reminder'
  | 'briefing'
  | 'checkin'
  | 'approval';

export interface QuietHoursConfig {
  enabled: boolean;
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number; // 0-23
  endMinute: number; // 0-59
}

export type ChannelSettings = Record<NotificationChannelKey, boolean>;

export interface NotificationStoreState {
  hasHydrated: boolean;
  quietHours: QuietHoursConfig;
  channels: ChannelSettings;
  deferredNotificationIds: string[];
  setHasHydrated: (hydrated: boolean) => void;
  setQuietHours: (partial: Partial<QuietHoursConfig>) => void;
  setChannelEnabled: (channel: NotificationChannelKey, enabled: boolean) => void;
  trackDeferredNotificationId: (id: string) => void;
  clearDeferredNotifications: () => Promise<void>;
  resetToDefaults: () => void;
}

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  enabled: false,
  startHour: 22,
  startMinute: 0,
  endHour: 7,
  endMinute: 0,
};

export const DEFAULT_CHANNELS: ChannelSettings = {
  task_completion: true,
  calendar_reminder: true,
  briefing: true,
  checkin: true,
  approval: true,
};

function clampInt(val: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || isNaN(val)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(val)));
}

export const useNotificationStore = create<NotificationStoreState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      quietHours: { ...DEFAULT_QUIET_HOURS },
      channels: { ...DEFAULT_CHANNELS },
      deferredNotificationIds: [],
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setQuietHours: (partial) => {
        const current = get().quietHours;
        const updated: QuietHoursConfig = {
          enabled: typeof partial.enabled === 'boolean' ? partial.enabled : current.enabled,
          startHour: clampInt(partial.startHour, 0, 23, current.startHour),
          startMinute: clampInt(partial.startMinute, 0, 59, current.startMinute),
          endHour: clampInt(partial.endHour, 0, 23, current.endHour),
          endMinute: clampInt(partial.endMinute, 0, 59, current.endMinute),
        };
        set({ quietHours: updated });
        if (updated.enabled === false) {
          get().clearDeferredNotifications().catch(() => {});
        }
      },
      setChannelEnabled: (channel, enabled) => {
        set((state) => ({
          channels: { ...state.channels, [channel]: enabled },
        }));
        if (!enabled) {
          Notifications.getAllScheduledNotificationsAsync?.().then((scheduled) => {
            for (const item of scheduled) {
              const data = item.content?.data as Record<string, unknown> | undefined;
              const itemChannel = data?.channel || data?.type;
              if (itemChannel === channel) {
                Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => {});
              }
            }
          }).catch(() => {});
        }
      },
      trackDeferredNotificationId: (id) =>
        set((state) => ({
          deferredNotificationIds: [...state.deferredNotificationIds, id],
        })),
      clearDeferredNotifications: async () => {
        const ids = get().deferredNotificationIds;
        for (const id of ids) {
          try {
            await Notifications.cancelScheduledNotificationAsync(id);
          } catch {
            // silent cleanup
          }
        }
        set({ deferredNotificationIds: [] });
      },
      resetToDefaults: () => {
        const { clearDeferredNotifications } = get();
        clearDeferredNotifications().catch(() => {});
        set({
          quietHours: { ...DEFAULT_QUIET_HOURS },
          channels: { ...DEFAULT_CHANNELS },
          deferredNotificationIds: [],
        });
      },
    }),
    {
      name: 'vela-notification-settings',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

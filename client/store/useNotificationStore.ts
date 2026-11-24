import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  clearDeferredNotificationIds: () => void;
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

const MAX_DEFERRED_IDS = 50;

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
      },
      setChannelEnabled: (channel, enabled) =>
        set((state) => ({
          channels: { ...state.channels, [channel]: enabled },
        })),
      trackDeferredNotificationId: (id) =>
        set((state) => {
          const next = [...state.deferredNotificationIds, id];
          // Prune older deferred notification IDs to keep state bounded
          if (next.length > MAX_DEFERRED_IDS) {
            return { deferredNotificationIds: next.slice(-MAX_DEFERRED_IDS) };
          }
          return { deferredNotificationIds: next };
        }),
      clearDeferredNotificationIds: () => set({ deferredNotificationIds: [] }),
      resetToDefaults: () =>
        set({
          quietHours: { ...DEFAULT_QUIET_HOURS },
          channels: { ...DEFAULT_CHANNELS },
          deferredNotificationIds: [],
        }),
    }),
    {
      name: 'vela-notification-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        quietHours: state.quietHours,
        channels: state.channels,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

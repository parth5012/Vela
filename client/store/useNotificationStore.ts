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
  quietHours: QuietHoursConfig;
  channels: ChannelSettings;
  setQuietHours: (partial: Partial<QuietHoursConfig>) => void;
  setChannelEnabled: (channel: NotificationChannelKey, enabled: boolean) => void;
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

export const useNotificationStore = create<NotificationStoreState>()(
  persist(
    (set) => ({
      quietHours: { ...DEFAULT_QUIET_HOURS },
      channels: { ...DEFAULT_CHANNELS },
      setQuietHours: (partial) =>
        set((state) => ({
          quietHours: { ...state.quietHours, ...partial },
        })),
      setChannelEnabled: (channel, enabled) =>
        set((state) => ({
          channels: { ...state.channels, [channel]: enabled },
        })),
      resetToDefaults: () =>
        set({
          quietHours: { ...DEFAULT_QUIET_HOURS },
          channels: { ...DEFAULT_CHANNELS },
        }),
    }),
    {
      name: 'vela-notification-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

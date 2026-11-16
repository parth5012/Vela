import { create } from 'zustand';

export type SyncState = 'online' | 'offline' | 'syncing' | 'error';

export interface OfflineStoreState {
  isOnline: boolean;
  isBackendReachable: boolean;
  syncState: SyncState;
  pendingQueueCount: number;
  lastChecked: number | null;
  isChecking: boolean;

  setOnline: (isOnline: boolean) => void;
  setBackendReachable: (isBackendReachable: boolean) => void;
  setSyncState: (syncState: SyncState) => void;
  setPendingQueueCount: (count: number) => void;
  incrementPendingQueue: () => void;
  decrementPendingQueue: (amount?: number) => void;
  setLastChecked: (timestamp: number) => void;
  setIsChecking: (isChecking: boolean) => void;
  reset: () => void;
}

export const useOfflineStore = create<OfflineStoreState>((set) => ({
  isOnline: true,
  isBackendReachable: true,
  syncState: 'online',
  pendingQueueCount: 0,
  lastChecked: null,
  isChecking: false,

  setOnline: (isOnline: boolean) =>
    set((state) => {
      const nextSyncState: SyncState = !isOnline
        ? 'offline'
        : !state.isBackendReachable
        ? 'offline'
        : state.syncState === 'offline'
        ? 'online'
        : state.syncState;
      return {
        isOnline,
        syncState: nextSyncState,
      };
    }),

  setBackendReachable: (isBackendReachable: boolean) =>
    set((state) => {
      const nextSyncState: SyncState = !state.isOnline || !isBackendReachable
        ? 'offline'
        : state.syncState === 'offline'
        ? 'online'
        : state.syncState;
      return {
        isBackendReachable,
        syncState: nextSyncState,
      };
    }),

  setSyncState: (syncState: SyncState) => set({ syncState }),

  setPendingQueueCount: (pendingQueueCount: number) =>
    set({ pendingQueueCount: Math.max(0, pendingQueueCount) }),

  incrementPendingQueue: () =>
    set((state) => ({ pendingQueueCount: state.pendingQueueCount + 1 })),

  decrementPendingQueue: (amount: number = 1) =>
    set((state) => ({
      pendingQueueCount: Math.max(0, state.pendingQueueCount - amount),
    })),

  setLastChecked: (lastChecked: number) => set({ lastChecked }),

  setIsChecking: (isChecking: boolean) => set({ isChecking }),

  reset: () =>
    set({
      isOnline: true,
      isBackendReachable: true,
      syncState: 'online',
      pendingQueueCount: 0,
      lastChecked: null,
      isChecking: false,
    }),
}));

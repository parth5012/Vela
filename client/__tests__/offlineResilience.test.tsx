import React from 'react';
import { StyleSheet } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { useOfflineStore } from '../store/useOfflineStore';
import { useConfigStore } from '../store/useConfigStore';
import OfflineBanner, { OFFLINE_BANNER_COPY } from '../components/ui/OfflineBanner';
import SyncStatusIndicator from '../components/ui/SyncStatusIndicator';
import QueueBadge from '../components/ui/QueueBadge';
import {
  checkBackendHealth,
  probeBackendHealth,
  normalizeHealthUrl,
  healthProbeManager,
} from '../utils/healthProbe';
import * as offlineSync from '../utils/offlineSync';
import { syncDatabase } from '../utils/syncManager';

// Mock dependencies
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 30, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => Promise.resolve([])),
    })),
  },
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
}));

jest.mock('../db/checkinRepository', () => ({
  flushUnsyncedCheckins: jest.fn(async () => ({ syncedCount: 0, failedCount: 0 })),
  loadUnsyncedCheckins: jest.fn(async () => []),
}));

jest.mock('../utils/syncManager', () => ({
  syncDatabase: jest.fn(async () => {}),
  subscribeToStandaloneSync: jest.fn(() => () => {}),
}));

describe('Offline Resilience & Health Probe', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    act(() => {
      useOfflineStore.getState().reset();
      useConfigStore.setState({
        theme: 'berry',
        accentColor: 'indigo',
        isConfigured: true,
        connectionMode: 'server',
        apiUrl: 'https://test-node.vela.ai',
        apiKey: 'test-key',
      });
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    healthProbeManager.stop();
  });

  describe('useOfflineStore', () => {
    it('initializes with default online state and 0 pending items', () => {
      const state = useOfflineStore.getState();
      expect(state.isOnline).toBe(true);
      expect(state.isBackendReachable).toBe(true);
      expect(state.syncState).toBe('online');
      expect(state.pendingQueueCount).toBe(0);
    });

    it('transitions syncState to offline when network disconnects', () => {
      act(() => {
        useOfflineStore.getState().setOnline(false);
      });
      expect(useOfflineStore.getState().isOnline).toBe(false);
      expect(useOfflineStore.getState().syncState).toBe('offline');

      act(() => {
        useOfflineStore.getState().setOnline(true);
      });
      expect(useOfflineStore.getState().isOnline).toBe(true);
      expect(useOfflineStore.getState().syncState).toBe('online');
    });

    it('transitions syncState to offline when backend is unreachable', () => {
      act(() => {
        useOfflineStore.getState().setBackendReachable(false);
      });
      expect(useOfflineStore.getState().isBackendReachable).toBe(false);
      expect(useOfflineStore.getState().syncState).toBe('offline');

      act(() => {
        useOfflineStore.getState().setBackendReachable(true);
      });
      expect(useOfflineStore.getState().isBackendReachable).toBe(true);
      expect(useOfflineStore.getState().syncState).toBe('online');
    });

    it('recovers from error state back to online when backend becomes reachable', () => {
      act(() => {
        useOfflineStore.getState().setSyncState('error');
      });
      expect(useOfflineStore.getState().syncState).toBe('error');

      act(() => {
        useOfflineStore.getState().setBackendReachable(true);
      });
      expect(useOfflineStore.getState().syncState).toBe('online');
    });

    it('correctly tracks pending queue count', () => {
      act(() => {
        useOfflineStore.getState().incrementPendingQueue();
        useOfflineStore.getState().incrementPendingQueue();
      });
      expect(useOfflineStore.getState().pendingQueueCount).toBe(2);

      act(() => {
        useOfflineStore.getState().decrementPendingQueue(1);
      });
      expect(useOfflineStore.getState().pendingQueueCount).toBe(1);

      act(() => {
        useOfflineStore.getState().setPendingQueueCount(5);
      });
      expect(useOfflineStore.getState().pendingQueueCount).toBe(5);

      act(() => {
        useOfflineStore.getState().decrementPendingQueue(10);
      });
      expect(useOfflineStore.getState().pendingQueueCount).toBe(0);
    });
  });

  describe('healthProbe utility', () => {
    it('normalizes URLs correctly', () => {
      expect(normalizeHealthUrl('http://my-node:8000/')).toBe('http://my-node:8000');
      expect(normalizeHealthUrl('my-node.example.com///')).toBe('https://my-node.example.com');
      expect(normalizeHealthUrl('https://my-node.example.com')).toBe('https://my-node.example.com');
    });

    it('returns true when /health responds 200 OK', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const isHealthy = await checkBackendHealth('https://node.vela.ai', 'key');
      expect(isHealthy).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://node.vela.ai/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer key',
          }),
        })
      );
    });

    it('returns false when /health responds with 500 error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const isHealthy = await checkBackendHealth('https://node.vela.ai', 'key');
      expect(isHealthy).toBe(false);
    });

    it('returns false when fetch throws network error or timeout', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await probeBackendHealth('https://node.vela.ai', 'key', 1000);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('executeProbe updates useOfflineStore reachability state', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      await healthProbeManager.executeProbe();
      expect(useOfflineStore.getState().isBackendReachable).toBe(false);
      expect(useOfflineStore.getState().syncState).toBe('offline');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      await healthProbeManager.executeProbe();
      expect(useOfflineStore.getState().isBackendReachable).toBe(true);
      expect(useOfflineStore.getState().syncState).toBe('online');
    });
  });

  describe('OfflineBanner Component', () => {
    it('renders null when app is online and reachable', () => {
      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<OfflineBanner />);
      });
      expect(tree!.toJSON()).toBeNull();
    });

    it('renders persistent offline banner with exact copy and safe area padding when offline', () => {
      act(() => {
        useOfflineStore.getState().setOnline(false);
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<OfflineBanner />);
      });

      const root = tree!.root;
      const banner = root.findByProps({ testID: 'offline-banner' });
      expect(banner).toBeDefined();

      // Check safe-area paddingTop calculation (Math.max(8, 30 + 4) = 34)
      const flatStyle = StyleSheet.flatten(banner.props.style);
      expect(flatStyle.paddingTop).toBe(34);

      const textInstance = root.findByProps({ children: OFFLINE_BANNER_COPY });
      expect(textInstance).toBeDefined();
    });

    it('renders persistent offline banner when backend is unreachable', () => {
      act(() => {
        useOfflineStore.getState().setBackendReachable(false);
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<OfflineBanner />);
      });

      const root = tree!.root;
      expect(root.findByProps({ testID: 'offline-banner' })).toBeDefined();
    });
  });

  describe('SyncStatusIndicator Component', () => {
    it('renders status dot with appropriate accessibility label', () => {
      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<SyncStatusIndicator />);
      });

      const root = tree!.root;
      const indicator = root.findByProps({ testID: 'sync-status-indicator' });
      expect(indicator.props.accessibilityLabel).toContain('Sync status: online');
    });

    it('updates accessibility label when offline or pending items exist', () => {
      act(() => {
        useOfflineStore.getState().setSyncState('offline');
        useOfflineStore.getState().setPendingQueueCount(3);
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<SyncStatusIndicator />);
      });

      const root = tree!.root;
      const indicator = root.findByProps({ testID: 'sync-status-indicator' });
      expect(indicator.props.accessibilityLabel).toContain('Sync status: offline, 3 pending');
    });
  });

  describe('QueueBadge Component', () => {
    it('renders null when pending queue count is 0', () => {
      act(() => {
        useOfflineStore.getState().setPendingQueueCount(0);
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<QueueBadge />);
      });
      expect(tree!.toJSON()).toBeNull();
    });

    it('renders count pill badge when pending queue count > 0', () => {
      act(() => {
        useOfflineStore.getState().setPendingQueueCount(4);
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<QueueBadge />);
      });

      const root = tree!.root;
      const badge = root.findByProps({ testID: 'queue-badge' });
      expect(badge).toBeDefined();
      expect(badge.props.accessibilityLabel).toBe('4 items queued for sync. Tap to sync now.');

      const text = root.findByProps({ children: '4 queued' });
      expect(text).toBeDefined();
    });

    it('handles singular item formatting correctly', () => {
      act(() => {
        useOfflineStore.getState().setPendingQueueCount(1);
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<QueueBadge />);
      });

      const badge = tree!.root.findByProps({ testID: 'queue-badge' });
      expect(badge.props.accessibilityLabel).toBe('1 item queued for sync. Tap to sync now.');
    });

    it('disables pressing when currently syncing', () => {
      act(() => {
        useOfflineStore.getState().setPendingQueueCount(2);
        useOfflineStore.getState().setSyncState('syncing');
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<QueueBadge />);
      });

      const badge = tree!.root.findByProps({ testID: 'queue-badge' });
      expect(badge.props.accessibilityState).toEqual({ disabled: true, busy: true });
    });

    it('triggers flushPendingMessages on press', () => {
      const flushSpy = jest.spyOn(offlineSync, 'flushPendingMessages').mockResolvedValue(undefined);

      act(() => {
        useOfflineStore.getState().setPendingQueueCount(2);
      });

      let tree: renderer.ReactTestRenderer | null = null;
      act(() => {
        tree = renderer.create(<QueueBadge />);
      });

      const badge = tree!.root.findByProps({ testID: 'queue-badge' });
      act(() => {
        badge.props.onPress();
      });

      expect(flushSpy).toHaveBeenCalled();
      flushSpy.mockRestore();
    });
  });

  describe('offlineSync single-flight & short-circuit', () => {
    it('collapses concurrent flushPendingMessages calls into a single execution', async () => {
      let resolveSync: () => void = () => {};
      const syncPromise = new Promise<void>((resolve) => {
        resolveSync = resolve;
      });
      (syncDatabase as jest.Mock).mockReturnValue(syncPromise);

      const p1 = offlineSync.flushPendingMessages();
      const p2 = offlineSync.flushPendingMessages();

      expect(p1).toBe(p2); // identical promise reference
      expect(syncDatabase).toHaveBeenCalledTimes(1);

      resolveSync();
      await p1;
    });

    it('short-circuits flush without network call when device is offline', async () => {
      useOfflineStore.getState().setOnline(false);

      await offlineSync.flushPendingMessages();

      expect(syncDatabase).not.toHaveBeenCalled();
      expect(useOfflineStore.getState().syncState).toBe('offline');
    });

    it('short-circuits flush without network call when backend is unreachable', async () => {
      useOfflineStore.getState().setBackendReachable(false);

      await offlineSync.flushPendingMessages();

      expect(syncDatabase).not.toHaveBeenCalled();
      expect(useOfflineStore.getState().syncState).toBe('offline');
    });
  });
});

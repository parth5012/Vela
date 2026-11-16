import { AppState } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore } from '../store/useChatStore';
import { useOfflineStore } from '../store/useOfflineStore';
import { healthProbeManager } from './healthProbe';
import { syncDatabase, subscribeToStandaloneSync } from './syncManager';
import { flushUnsyncedCheckins, loadUnsyncedCheckins } from '../db/checkinRepository';
import { db } from '../db/client';
import { operationLog } from '../db/schema';

let wired = false;
let flushInFlight: Promise<void> | null = null;

/**
 * Reads total pending offline queue count from operationLog and unsynced check-ins.
 */
export async function getPendingQueueCount(): Promise<number> {
  let count = 0;
  if (!db) return 0;

  try {
    const ops = await db.select({ id: operationLog.id }).from(operationLog);
    if (ops && Array.isArray(ops)) {
      count += ops.length;
    }
  } catch (err) {
    console.warn('[offlineSync] Error reading pending operations:', err);
  }

  try {
    const unsyncedCheckins = await loadUnsyncedCheckins();
    if (unsyncedCheckins && Array.isArray(unsyncedCheckins)) {
      count += unsyncedCheckins.length;
    }
  } catch (err) {
    console.warn('[offlineSync] Error reading unsynced check-ins:', err);
  }

  return count;
}

/**
 * Refreshes the pending queue count in useOfflineStore.
 */
export async function refreshPendingQueueCount(): Promise<number> {
  const count = await getPendingQueueCount();
  useOfflineStore.getState().setPendingQueueCount(count);
  return count;
}

/**
 * Attempts to flush locally-queued (pending) messages to the backend.
 * Single-flight: concurrent calls collapse into the in-flight execution.
 * Request-based per map decision #84: if the backend is unreachable the push
 * is skipped and we keep the queue pending for the next trigger.
 */
export function flushPendingMessages(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = doFlushPendingMessages().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function doFlushPendingMessages(): Promise<void> {
  const config = useConfigStore.getState();
  const offlineStore = useOfflineStore.getState();

  if (config.connectionMode !== 'server' || !config.apiUrl || !config.apiKey) {
    await refreshPendingQueueCount();
    return;
  }

  // Decision #84: request-based — do not hammer an offline or unreachable node
  if (!offlineStore.isOnline || !offlineStore.isBackendReachable) {
    await refreshPendingQueueCount();
    return;
  }

  offlineStore.setSyncState('syncing');
  let hadError = false;

  try {
    await syncDatabase(config.apiUrl, config.apiKey);
  } catch (error) {
    hadError = true;
    console.warn('[offlineSync] Flush failed (backend unreachable?), keeping queue pending:', error);
  }

  try {
    const checkinResult = await flushPendingCheckins(config.apiUrl, config.apiKey);
    if (checkinResult.failedCount > 0) {
      hadError = true;
    }
  } catch (error) {
    hadError = true;
    console.warn('[offlineSync] Check-in flush failed:', error);
  }

  await refreshPendingQueueCount();
  const latestOffline = useOfflineStore.getState();
  if (hadError) {
    latestOffline.setSyncState('error');
  } else {
    latestOffline.setSyncState(
      latestOffline.isOnline && latestOffline.isBackendReachable ? 'online' : 'offline'
    );
  }
}

/**
 * Flushes locally-queued check-ins (synced = false) to POST /api/checkins.
 * Single-tenant device: rows flush under the most recent thread id.
 * Failures keep rows pending for the next trigger.
 */
export async function flushPendingCheckins(
  apiUrl: string,
  apiKey: string
): Promise<{ syncedCount: number; failedCount: number }> {
  try {
    const conversationId = useChatStore.getState().threads?.[0]?.id;
    if (!conversationId) {
      return { syncedCount: 0, failedCount: 0 };
    }
    return await flushUnsyncedCheckins(apiUrl, apiKey, conversationId);
  } catch (error) {
    console.warn('[offlineSync] Check-in flush failed, keeping queue pending:', error);
    return { syncedCount: 0, failedCount: 1 };
  }
}

/**
 * Wires an AppState listener so pending offline messages flush whenever the
 * app returns to the foreground. Idempotent — safe to call multiple times.
 */
export function wireOfflineSync(): void {
  if (wired) return;
  wired = true;
  healthProbeManager.setOnConnectivityRestored(() => {
    flushPendingMessages();
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      flushPendingMessages();
    }
  });
  try {
    subscribeToStandaloneSync(() => {
      refreshPendingQueueCount();
    });
  } catch {
    // ignore in environments where standalone sync is mocked
  }
}

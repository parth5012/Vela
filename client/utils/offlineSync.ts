import { AppState } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore } from '../store/useChatStore';
import { syncDatabase } from './syncManager';
import { flushUnsyncedCheckins } from '../db/checkinRepository';

let wired = false;

/**
 * Attempts to flush locally-queued (pending) messages to the backend.
 * Request-based per map decision #84: if the backend is unreachable the push
 * throws and we simply leave the queue pending for the next trigger.
 */
export async function flushPendingMessages(): Promise<void> {
  const config = useConfigStore.getState();
  if (config.isLocalMode || !config.apiUrl || !config.apiKey) {
    return;
  }
  try {
    await syncDatabase(config.apiUrl, config.apiKey);
  } catch (error) {
    console.warn('[offlineSync] Flush failed (backend unreachable?), keeping queue pending:', error);
  }
  await flushPendingCheckins(config.apiUrl, config.apiKey);
}

/**
 * Flushes locally-queued check-ins (synced = false) to POST /api/checkins.
 * Single-tenant device: rows flush under the most recent thread id.
 * Failures keep rows pending for the next trigger.
 */
export async function flushPendingCheckins(apiUrl: string, apiKey: string): Promise<void> {
  try {
    const conversationId = useChatStore.getState().threads?.[0]?.id;
    if (!conversationId) {
      return;
    }
    await flushUnsyncedCheckins(apiUrl, apiKey, conversationId);
  } catch (error) {
    console.warn('[offlineSync] Check-in flush failed, keeping queue pending:', error);
  }
}

/**
 * Wires an AppState listener so pending offline messages flush whenever the
 * app returns to the foreground. Idempotent — safe to call multiple times.
 */
export function wireOfflineSync(): void {
  if (wired) return;
  wired = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      flushPendingMessages();
    }
  });
}

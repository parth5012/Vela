import { AppState } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';
import { syncDatabase } from './syncManager';

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

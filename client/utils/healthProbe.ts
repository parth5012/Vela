import { AppState, AppStateStatus, Platform } from 'react-native';
import { useOfflineStore } from '../store/useOfflineStore';
import { useConfigStore } from '../store/useConfigStore';

export interface HealthProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs?: number;
}

export function normalizeHealthUrl(apiUrl: string): string {
  let formatted = apiUrl.trim();
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'https://' + formatted;
  }
  return formatted.replace(/\/+$/, '');
}

/**
 * Checks connectivity to the backend /health endpoint with a strict timeout.
 */
export async function checkBackendHealth(
  apiUrl: string,
  apiKey?: string,
  timeoutMs: number = 3000
): Promise<boolean> {
  const result = await probeBackendHealth(apiUrl, apiKey, timeoutMs);
  return result.ok;
}

/**
 * Detailed probe of backend /health returning status, latency, and error message.
 */
export async function probeBackendHealth(
  apiUrl: string,
  apiKey?: string,
  timeoutMs: number = 3000
): Promise<HealthProbeResult> {
  if (!apiUrl) {
    return { ok: false, error: 'No API URL provided' };
  }

  const base = normalizeHealthUrl(apiUrl);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (apiKey && apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    const response = await fetch(`${base}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const isTimeout = err?.name === 'AbortError';
    return {
      ok: false,
      error: isTimeout ? `Timed out after ${timeoutMs}ms` : err?.message || 'Network request failed',
      latencyMs,
    };
  }
}

class HealthProbeManager {
  private intervalTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private currentAppState: AppStateStatus = 'active';
  private appStateSubscription: { remove: () => void } | null = null;
  private onlineListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;

  private intervalMs: number = 30000;

  start(intervalMs: number = 30000) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalMs = intervalMs;

    // Run initial probe
    this.executeProbe();

    // Setup periodic probe
    this.startInterval();

    // Monitor AppState lifecycle
    try {
      this.currentAppState = AppState.currentState;
      const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        const wasBackground = this.currentAppState !== 'active';
        this.currentAppState = nextState;
        if (nextState === 'active') {
          if (wasBackground) {
            // Immediately probe on foreground resume
            this.executeProbe();
          }
          this.startInterval();
        } else {
          // Pause background interval timer
          this.stopInterval();
        }
      });
      this.appStateSubscription = sub;
    } catch {
      // AppState may be absent in some test environments
    }

    // Monitor browser online/offline events if running on Web
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.onlineListener = () => {
        useOfflineStore.getState().setOnline(true);
        this.debouncedProbe(2000);
      };
      this.offlineListener = () => {
        useOfflineStore.getState().setOnline(false);
      };

      window.addEventListener('online', this.onlineListener);
      window.addEventListener('offline', this.offlineListener);
    }
  }

  private startInterval() {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => {
      if (this.currentAppState === 'active') {
        this.executeProbe();
      }
    }, this.intervalMs);
  }

  private stopInterval() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  stop() {
    this.isRunning = false;
    this.stopInterval();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      if (this.onlineListener) {
        window.removeEventListener('online', this.onlineListener);
        this.onlineListener = null;
      }
      if (this.offlineListener) {
        window.removeEventListener('offline', this.offlineListener);
        this.offlineListener = null;
      }
    }
  }

  debouncedProbe(delayMs: number = 2000) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.executeProbe();
    }, delayMs);
  }

  async executeProbe(): Promise<boolean> {
    const config = useConfigStore.getState();
    const offlineStore = useOfflineStore.getState();

    // If Vela node is not configured or in local mode, assume online
    if (!config.isConfigured || !config.apiUrl) {
      offlineStore.setBackendReachable(true);
      offlineStore.setIsChecking(false);
      offlineStore.setLastChecked(Date.now());
      return true;
    }

    offlineStore.setIsChecking(true);
    const result = await probeBackendHealth(config.apiUrl, config.apiKey);
    offlineStore.setIsChecking(false);
    offlineStore.setBackendReachable(result.ok);
    offlineStore.setLastChecked(Date.now());

    return result.ok;
  }
}

export const healthProbeManager = new HealthProbeManager();

export function startHealthProbeService(intervalMs: number = 30000): () => void {
  healthProbeManager.start(intervalMs);
  return () => healthProbeManager.stop();
}

export function stopHealthProbeService(): void {
  healthProbeManager.stop();
}

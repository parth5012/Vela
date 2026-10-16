import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage key for active GPU initialization session marker.
 * Written immediately BEFORE native GPU init; removed immediately AFTER successful init.
 *
 * If a native GPU driver fault crashes the process (e.g. SIGSEGV in OpenCL/Vulkan runtime),
 * the process terminates instantly before any JavaScript catch or finally block can run.
 * On subsequent launch, finding this marker indicates the previous process died during GPU init.
 */
export const LITERT_GPU_INIT_SESSION_KEY = '@vela:litert:gpu_init_session';

/**
 * Storage key for the persisted GPU crash flag.
 * Set once a crashed session marker is detected on launch, and persists across sessions
 * until explicitly cleared by the user in Settings.
 */
export const LITERT_GPU_CRASH_FLAG_KEY = '@vela:litert:gpu_crash_flag';

export interface GpuInitSessionMarker {
  backend: string;
  modelName: string;
  timestamp: number;
}

export interface GpuCrashFlagDetails {
  backend: string;
  modelName: string;
  timestamp: number;
  consumed?: boolean;
}

export interface DetectCrashedGpuInitResult {
  crashed: boolean;
  backend?: string;
  modelName?: string;
  timestamp?: number;
  consumed?: boolean;
}

/**
 * Determines whether a given backend represents GPU acceleration.
 * Only GPU backends ('opencl' | 'vulkan') can trigger GPU driver crashes.
 */
export function isGpuBackend(backend?: string | null): boolean {
  if (!backend) return false;
  const normalized = backend.toLowerCase().trim();
  return normalized === 'opencl' || normalized === 'vulkan';
}

/**
 * Records the start of a GPU initialization attempt.
 *
 * NOTE: This marker MUST be written before invoking the native LiteRT / MediaPipe bridge.
 * If the native call triggers a hard signal (SIGSEGV/SIGABRT), the process dies immediately
 * and JS runtime execution halts. Writing beforehand ensures persistent evidence of the crash.
 *
 * No-op for CPU backend: CPU initialization cannot produce GPU driver crashes and must
 * never produce false positives.
 */
export async function beginGpuInitSession(
  backend: string,
  modelName: string
): Promise<void> {
  if (!isGpuBackend(backend)) {
    return;
  }

  const marker: GpuInitSessionMarker = {
    backend,
    modelName,
    timestamp: Date.now(),
  };

  await AsyncStorage.setItem(LITERT_GPU_INIT_SESSION_KEY, JSON.stringify(marker));
}

/**
 * Marks GPU initialization as successfully completed by removing the session marker.
 */
export async function completeGpuInitSession(): Promise<void> {
  await AsyncStorage.removeItem(LITERT_GPU_INIT_SESSION_KEY);
}

/**
 * Scans for an incomplete GPU initialization session marker from a previous launch.
 *
 * If a marker with a GPU backend is found on startup, it proves the previous process died
 * before completing initialization (e.g., hard driver crash). The marker is promoted to
 * a persisted crash flag, and the session marker is removed.
 *
 * MediaPipe tasks-genai >= 0.10.24 floor requirement is preserved; this guard prevents
 * repeated process crash loops when native GPU delegates fail.
 */
export async function detectCrashedGpuInit(): Promise<DetectCrashedGpuInitResult> {
  const raw = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
  if (!raw) {
    return { crashed: false };
  }

  try {
    const marker = JSON.parse(raw) as Partial<GpuInitSessionMarker>;
    if (marker && isGpuBackend(marker.backend)) {
      const details: GpuCrashFlagDetails = {
        backend: marker.backend as string,
        modelName: marker.modelName ?? 'unknown',
        timestamp: marker.timestamp ?? Date.now(),
        consumed: false,
      };

      await AsyncStorage.setItem(LITERT_GPU_CRASH_FLAG_KEY, JSON.stringify(details));
      await AsyncStorage.removeItem(LITERT_GPU_INIT_SESSION_KEY);

      return {
        crashed: true,
        backend: details.backend,
        modelName: details.modelName,
        timestamp: details.timestamp,
        consumed: false,
      };
    }
  } catch {
    // Malformed marker data; clean up to prevent infinite failure loops
  }

  await AsyncStorage.removeItem(LITERT_GPU_INIT_SESSION_KEY);
  return { crashed: false };
}

/**
 * Returns true if a GPU crash flag has been recorded and is currently active.
 */
export async function isGpuCrashFlagSet(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LITERT_GPU_CRASH_FLAG_KEY);
  return raw !== null;
}

/**
 * Retrieves the details of the active GPU crash flag, or null if none is set.
 */
export async function getGpuCrashFlagDetails(): Promise<GpuCrashFlagDetails | null> {
  const raw = await AsyncStorage.getItem(LITERT_GPU_CRASH_FLAG_KEY);
  if (!raw) {
    return null;
  }

  try {
    const details = JSON.parse(raw) as GpuCrashFlagDetails;
    if (details && typeof details.backend === 'string') {
      return {
        backend: details.backend,
        modelName: details.modelName ?? 'unknown',
        timestamp: typeof details.timestamp === 'number' ? details.timestamp : Date.now(),
        consumed: Boolean(details.consumed),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Marks an active GPU crash flag as consumed (persisted).
 * This indicates the one-shot CPU-safe downgrade has been applied for a session.
 */
export async function markGpuCrashFlagConsumed(): Promise<void> {
  const details = await getGpuCrashFlagDetails();
  if (details) {
    details.consumed = true;
    await AsyncStorage.setItem(LITERT_GPU_CRASH_FLAG_KEY, JSON.stringify(details));
  }
}

/**
 * Clears the GPU crash flag and any leftover session marker, allowing the user
 * to retry GPU acceleration after a crash.
 */
export async function clearGpuCrashFlag(): Promise<void> {
  await AsyncStorage.removeItem(LITERT_GPU_CRASH_FLAG_KEY);
  await AsyncStorage.removeItem(LITERT_GPU_INIT_SESSION_KEY);
}

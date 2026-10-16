import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginGpuInitSession,
  completeGpuInitSession,
  detectCrashedGpuInit,
  isGpuCrashFlagSet,
  getGpuCrashFlagDetails,
  clearGpuCrashFlag,
  markGpuCrashFlagConsumed,
  isGpuBackend,
  LITERT_GPU_INIT_SESSION_KEY,
  LITERT_GPU_CRASH_FLAG_KEY,
} from '../liteRtCrashFlag';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('liteRtCrashFlag', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    await clearGpuCrashFlag();
  });

  describe('isGpuBackend', () => {
    it('returns true for opencl and vulkan backends', () => {
      expect(isGpuBackend('opencl')).toBe(true);
      expect(isGpuBackend('vulkan')).toBe(true);
      expect(isGpuBackend('OPENCL')).toBe(true);
      expect(isGpuBackend(' Vulkan ')).toBe(true);
    });

    it('returns false for cpu and unknown backends', () => {
      expect(isGpuBackend('cpu')).toBe(false);
      expect(isGpuBackend('CPU')).toBe(false);
      expect(isGpuBackend('auto')).toBe(false);
      expect(isGpuBackend('')).toBe(false);
      expect(isGpuBackend(undefined)).toBe(false);
      expect(isGpuBackend(null)).toBe(false);
    });
  });

  describe('beginGpuInitSession & completeGpuInitSession', () => {
    it('writes session marker only for GPU backends', async () => {
      await beginGpuInitSession('opencl', 'Qwen2.5 0.5B');

      const raw = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      expect(raw).not.toBeNull();
      const marker = JSON.parse(raw!);
      expect(marker.backend).toBe('opencl');
      expect(marker.modelName).toBe('Qwen2.5 0.5B');
      expect(typeof marker.timestamp).toBe('number');
    });

    it('writes session marker for vulkan backend', async () => {
      await beginGpuInitSession('vulkan', 'TinyLlama 1.1B');

      const raw = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      expect(raw).not.toBeNull();
      const marker = JSON.parse(raw!);
      expect(marker.backend).toBe('vulkan');
      expect(marker.modelName).toBe('TinyLlama 1.1B');
    });

    it('does NOT write marker for CPU backends (prevents false positives)', async () => {
      await beginGpuInitSession('cpu', 'SmolLM 135M');

      const raw = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      expect(raw).toBeNull();
    });

    it('removes session marker on successful init completion', async () => {
      await beginGpuInitSession('opencl', 'Qwen2.5 0.5B');
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).not.toBeNull();

      await completeGpuInitSession();
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
    });
  });

  describe('detectCrashedGpuInit', () => {
    it('returns crashed=false when no session marker is present', async () => {
      const result = await detectCrashedGpuInit();
      expect(result).toEqual({ crashed: false });
      expect(await isGpuCrashFlagSet()).toBe(false);
    });

    it('persists crash flag and returns crashed=true when stale GPU marker is found', async () => {
      const fixedTimestamp = 1700000000000;
      await AsyncStorage.setItem(
        LITERT_GPU_INIT_SESSION_KEY,
        JSON.stringify({
          backend: 'opencl',
          modelName: 'DeepSeek-R1 1.5B',
          timestamp: fixedTimestamp,
        })
      );

      const result = await detectCrashedGpuInit();

      expect(result.crashed).toBe(true);
      expect(result.backend).toBe('opencl');
      expect(result.modelName).toBe('DeepSeek-R1 1.5B');
      expect(result.timestamp).toBe(fixedTimestamp);
      expect(result.consumed).toBe(false);

      // Session marker must be cleaned up
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();

      // Crash flag must be persisted with consumed=false
      expect(await isGpuCrashFlagSet()).toBe(true);
      const details = await getGpuCrashFlagDetails();
      expect(details).toEqual({
        backend: 'opencl',
        modelName: 'DeepSeek-R1 1.5B',
        timestamp: fixedTimestamp,
        consumed: false,
      });
    });

    it('cleans up and returns crashed=false for CPU or invalid markers', async () => {
      await AsyncStorage.setItem(
        LITERT_GPU_INIT_SESSION_KEY,
        JSON.stringify({
          backend: 'cpu',
          modelName: 'SmolLM 135M',
          timestamp: Date.now(),
        })
      );

      const result = await detectCrashedGpuInit();

      expect(result).toEqual({ crashed: false });
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
      expect(await isGpuCrashFlagSet()).toBe(false);
    });

    it('handles corrupted JSON in session marker gracefully without throwing', async () => {
      await AsyncStorage.setItem(LITERT_GPU_INIT_SESSION_KEY, '{invalid-json');

      const result = await detectCrashedGpuInit();

      expect(result).toEqual({ crashed: false });
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
      expect(await isGpuCrashFlagSet()).toBe(false);
    });
  });

  describe('clearGpuCrashFlag', () => {
    it('clears both crash flag and leftover session marker', async () => {
      await AsyncStorage.setItem(
        LITERT_GPU_CRASH_FLAG_KEY,
        JSON.stringify({ backend: 'opencl', modelName: 'test', timestamp: 123 })
      );
      await AsyncStorage.setItem(
        LITERT_GPU_INIT_SESSION_KEY,
        JSON.stringify({ backend: 'opencl', modelName: 'test', timestamp: 123 })
      );

      expect(await isGpuCrashFlagSet()).toBe(true);

      await clearGpuCrashFlag();

      expect(await isGpuCrashFlagSet()).toBe(false);
      expect(await getGpuCrashFlagDetails()).toBeNull();
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
    });
  });

  describe('markGpuCrashFlagConsumed', () => {
    it('sets consumed=true on an active crash flag', async () => {
      await AsyncStorage.setItem(
        LITERT_GPU_CRASH_FLAG_KEY,
        JSON.stringify({ backend: 'opencl', modelName: 'test', timestamp: 123, consumed: false })
      );

      await markGpuCrashFlagConsumed();

      const details = await getGpuCrashFlagDetails();
      expect(details?.consumed).toBe(true);
    });

    it('does nothing when no crash flag is set', async () => {
      await markGpuCrashFlagConsumed();
      expect(await getGpuCrashFlagDetails()).toBeNull();
    });
  });
});

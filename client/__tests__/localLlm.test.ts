import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockLlamaContext = {
  completion: jest.fn(),
  release: jest.fn(async () => {}),
};
jest.mock('llama.rn', () => ({
  initLlama: jest.fn(async () => mockLlamaContext),
  LlamaContext: jest.fn(),
}));

import { initLlama } from 'llama.rn';

// Mock react-native NativeModules
// Streaming is event-based (see utils/localLlm.ts): the native module emits
// `GemmaLlmStream` events rather than invoking one-shot bridge Callbacks.
let streamListener: ((event: any) => void) | null = null;

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  actual.NativeModules.GemmaReactNativeModule = {
    initializeLocalModel: jest.fn(),
    unloadLocalModel: jest.fn(),
    streamLlmResponse: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  // Note: do NOT spread `actual` — react-native's index uses lazy getters and
  // spreading force-evaluates them, which blows up under jest-expo.
  class MockEmitter {
    addListener(_name: string, cb: (event: any) => void) {
      streamListener = cb;
      return { remove: () => { streamListener = null; } };
    }
  }
  Object.defineProperty(actual, 'NativeEventEmitter', {
    value: MockEmitter,
    writable: true,
    configurable: true,
  });
  return actual;
});

/** Pushes a sequence of stream events to the registered listener. */
function emitStream(events: any[]) {
  for (const e of events) {
    streamListener?.(e);
  }
}

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

let mockSecureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key) => mockSecureStore[key] || null),
  setItemAsync: jest.fn(async (key, value) => {
    mockSecureStore[key] = value;
  }),
  deleteItemAsync: jest.fn(async (key) => {
    delete mockSecureStore[key];
  }),
}));

jest.mock('../modules/stable-diffusion', () => ({
  getGpuInfo: jest.fn(async () => ({ hardware: 'qcom', vendor: 'adreno' })),
}));

import {
  initializeLocalModel,
  unloadLocalModel,
  isLocalModelLoaded,
  streamLocalLlmResponse,
  isLocalLlmDown,
  setLocalLlmDown,
  getLocalLlmFallbackReason,
} from '../utils/localLlm';
import { useConfigStore } from '../store/useConfigStore';
import {
  LITERT_GPU_INIT_SESSION_KEY,
  LITERT_GPU_CRASH_FLAG_KEY,
  clearGpuCrashFlag,
  isGpuCrashFlagSet,
  detectCrashedGpuInit,
} from '../utils/liteRtCrashFlag';
import { resetGpuVendorCache } from '../utils/ramDetection';

const GemmaNative = NativeModules.GemmaReactNativeModule;

describe('localLlm wrapper', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetGpuVendorCache();
    await clearGpuCrashFlag();
    useConfigStore.getState().setGpuBackendPreference('auto');
    // Must match the default `localModelName` in useConfigStore and use the
    // LiteRT `.task` extension that initializeLocalModel now requires.
    await AsyncStorage.setItem(
      'local_model_downloaded_DeepSeek-R1 1.5B (GGUF)_path',
      'file:///test/path/to/model.task'
    );
  });

  afterEach(async () => {
    if (isLocalModelLoaded) {
      await unloadLocalModel();
    }
    resetGpuVendorCache();
    await clearGpuCrashFlag();
    useConfigStore.getState().setGpuBackendPreference('auto');
  });

  it('should initialize state unloaded', () => {
    expect(isLocalModelLoaded).toBe(false);
  });

  it('should throw error when trying to stream while unloaded', async () => {
    await expect(async () => {
      const generator = streamLocalLlmResponse('Hello');
      await generator.next();
    }).rejects.toThrow('Local model not loaded. Call initializeLocalModel() first.');
  });

  it('should successfully initialize and set isLocalModelLoaded to true', async () => {
    (GemmaNative.initializeLocalModel as jest.Mock).mockResolvedValueOnce(undefined);

    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);
    expect(GemmaNative.initializeLocalModel).toHaveBeenCalledTimes(1);
    expect(GemmaNative.initializeLocalModel).toHaveBeenCalledWith('/test/path/to/model.task');
  });

  it('should successfully unload and set isLocalModelLoaded to false', async () => {
    (GemmaNative.initializeLocalModel as jest.Mock).mockResolvedValueOnce(undefined);
    (GemmaNative.unloadLocalModel as jest.Mock).mockResolvedValueOnce(undefined);

    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);

    await unloadLocalModel();
    expect(isLocalModelLoaded).toBe(false);
    expect(GemmaNative.unloadLocalModel).toHaveBeenCalledTimes(1);
  });

  it('should stream response using native module if available', async () => {
    (GemmaNative.initializeLocalModel as jest.Mock).mockResolvedValueOnce(undefined);
    (GemmaNative.streamLlmResponse as jest.Mock).mockImplementationOnce(async () => {
      // Events arrive after the start call resolves.
      setTimeout(
        () =>
          emitStream([
            { type: 'token', token: 'Mocked ' },
            { type: 'token', token: 'Native ' },
            { type: 'token', token: 'Response' },
            { type: 'done' },
          ]),
        0
      );
    });

    await initializeLocalModel();

    const tokens: string[] = [];
    const onTokenSpy = jest.fn((token) => tokens.push(token));

    const generator = streamLocalLlmResponse('Hello native', onTokenSpy);
    const yielded: string[] = [];
    for await (const chunk of generator) {
      yielded.push(chunk);
    }

    expect(onTokenSpy).toHaveBeenCalledTimes(3);
    expect(tokens).toEqual(['Mocked ', 'Native ', 'Response']);
    expect(yielded).toEqual(['Mocked ', 'Native ', 'Response']);
    expect(GemmaNative.streamLlmResponse).toHaveBeenCalledWith('Hello native');
  });

  it('should gracefully fall back to mock helper if native streaming fails', async () => {
    (GemmaNative.initializeLocalModel as jest.Mock).mockResolvedValueOnce(undefined);
    (GemmaNative.streamLlmResponse as jest.Mock).mockImplementationOnce(async () => {
      setTimeout(() => emitStream([{ type: 'error', message: 'Native stream error' }]), 0);
    });

    await initializeLocalModel();

    const tokens: string[] = [];
    const onTokenSpy = jest.fn((token) => tokens.push(token));

    const generator = streamLocalLlmResponse('hi', onTokenSpy);
    const yielded: string[] = [];
    for await (const chunk of generator) {
      yielded.push(chunk);
    }

    expect(onTokenSpy).toHaveBeenCalled();
    const joinedYielded = yielded.join('');
    // The fallback must announce itself as mock output and surface the reason,
    // so a broken local model can never look like a working one.
    expect(joinedYielded).toContain('Mock mode');
    expect(joinedYielded).toContain('Native stream error');
  });

  it('should stream mock response when native module missing methods or throws during init', async () => {
    (GemmaNative.initializeLocalModel as jest.Mock).mockRejectedValueOnce(new Error('init error'));

    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);

    const tokens: string[] = [];
    const onTokenSpy = jest.fn((token) => tokens.push(token));

    const generator = streamLocalLlmResponse('Tell me something about yourself', onTokenSpy);
    const yielded: string[] = [];
    for await (const chunk of generator) {
      yielded.push(chunk);
    }

    expect(onTokenSpy).toHaveBeenCalled();
    const resultText = yielded.join('');
    expect(resultText).toContain('Mock mode');
    expect(resultText).toContain('init error');
  });

  it('should route a GGUF model to the llama.rn engine, not MediaPipe', async () => {
    await AsyncStorage.setItem(
      'local_model_downloaded_DeepSeek-R1 1.5B (GGUF)_path',
      'file:///test/path/to/model.gguf'
    );

    mockLlamaContext.completion.mockImplementationOnce(
      async (
        params: { prompt: string },
        callback?: (data: { token?: string }) => void
      ) => {
        await new Promise((resolve) =>
          setTimeout(() => {
            callback?.({ token: 'GGUF ' });
            callback?.({ token: 'response' });
            resolve(null);
          }, 0)
        );
        return {};
      }
    );

    await initializeLocalModel();

    // The GGUF path must go to llama.rn, never to the MediaPipe native module.
    expect(GemmaNative.initializeLocalModel).not.toHaveBeenCalled();
    expect(initLlama).toHaveBeenCalledTimes(1);
    expect(initLlama).toHaveBeenCalledWith(
      expect.objectContaining({ model: '/test/path/to/model.gguf' }),
      expect.any(Function)
    );

    const yielded: string[] = [];
    for await (const chunk of streamLocalLlmResponse('hello')) {
      yielded.push(chunk);
    }
    expect(yielded.join('')).toBe('GGUF response');
  });

  it('should release the llama.rn context on unload', async () => {
    await AsyncStorage.setItem(
      'local_model_downloaded_DeepSeek-R1 1.5B (GGUF)_path',
      'file:///test/path/to/model.gguf'
    );

    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);

    await unloadLocalModel();
    expect(mockLlamaContext.release).toHaveBeenCalledTimes(1);
    expect(isLocalModelLoaded).toBe(false);
  });

  it('should fall back to mock when llama.rn init fails', async () => {
    await AsyncStorage.setItem(
      'local_model_downloaded_DeepSeek-R1 1.5B (GGUF)_path',
      'file:///test/path/to/model.gguf'
    );
    (initLlama as jest.Mock).mockRejectedValueOnce(new Error('gguf init failed'));

    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);

    const yielded: string[] = [];
    for await (const chunk of streamLocalLlmResponse('hello')) {
      yielded.push(chunk);
    }
    const resultText = yielded.join('');
    expect(resultText).toContain('Mock mode');
    expect(resultText).toContain('gguf init failed');
  });

  it('should throw error when local LLM set down', async () => {
    setLocalLlmDown(true);
    await expect(initializeLocalModel()).rejects.toThrow('Local LLM is down/unavailable.');

    // Test streaming throws when down
    const generator = streamLocalLlmResponse('weather');
    await expect(async () => {
      await generator.next();
    }).rejects.toThrow('Local LLM is down/unavailable.');

    setLocalLlmDown(false); // reset
  });

  describe('LiteRT GPU crash flag to CPU-safe fallback', () => {
    it('should boot CPU-safe and set honest mock fallback reason when GPU crash flag is set', async () => {
      // Seed an active GPU crash flag from a previous session crash
      await AsyncStorage.setItem(
        LITERT_GPU_CRASH_FLAG_KEY,
        JSON.stringify({
          backend: 'opencl',
          modelName: 'DeepSeek-R1 1.5B (GGUF)',
          timestamp: Date.now(),
          consumed: false,
        })
      );
      useConfigStore.getState().setGpuBackendPreference('auto');

      // Native module throws during init, forcing mock fallback
      (GemmaNative.initializeLocalModel as jest.Mock).mockRejectedValueOnce(
        new Error('Driver init failed')
      );

      await initializeLocalModel();

      // 1. Preference must NOT be overwritten in config store (one-shot downgrade)
      expect(useConfigStore.getState().gpuBackendPreference).toBe('auto');

      // 2. Mock fallback reason must honestly indicate CPU-safe boot after GPU crash
      const fallbackReason = getLocalLlmFallbackReason();
      expect(fallbackReason).not.toBeNull();
      expect(fallbackReason).toContain('LiteRT GPU crash detected');
      expect(fallbackReason).toContain('CPU-safe');

      // 3. Streaming response in fallback mode must include mock honesty prefix
      const tokens: string[] = [];
      const onTokenSpy = jest.fn((token) => tokens.push(token));
      const generator = streamLocalLlmResponse('Hello', onTokenSpy);
      for await (const _ of generator) {
        // drain generator
      }

      const fullText = tokens.join('');
      expect(fullText).toContain('[Mock mode — the local model is NOT running]');
      expect(fullText).toContain('LiteRT GPU crash detected');
    });

    it('should detect stale GPU session marker from hard crash, persist crash flag, and boot CPU-safe', async () => {
      // Simulate hard native process death (SIGSEGV): marker left behind from killed process
      await AsyncStorage.setItem(
        LITERT_GPU_INIT_SESSION_KEY,
        JSON.stringify({
          backend: 'vulkan',
          modelName: 'DeepSeek-R1 1.5B (GGUF)',
          timestamp: 1700000000000,
        })
      );
      useConfigStore.getState().setGpuBackendPreference('auto');

      let markerDuringNativeCall: string | null = null;
      (GemmaNative.initializeLocalModel as jest.Mock).mockImplementationOnce(async () => {
        markerDuringNativeCall = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      });

      await initializeLocalModel();

      // Stale marker promoted to persisted crash flag and removed from session key
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
      expect(await isGpuCrashFlagSet()).toBe(true);

      // Backend forced CPU-safe for this launch: no GPU session marker written during init
      expect(markerDuringNativeCall).toBeNull();
      expect(useConfigStore.getState().gpuBackendPreference).toBe('auto');
      expect(isLocalModelLoaded).toBe(true);
    });

    it('should write GPU session marker before native call and remove it on success when GPU backend configured', async () => {
      useConfigStore.getState().setGpuBackendPreference('opencl');

      let markerPresentDuringNativeCall: string | null = null;
      (GemmaNative.initializeLocalModel as jest.Mock).mockImplementationOnce(async () => {
        // Inspect AsyncStorage state during native call: marker MUST be written beforehand
        markerPresentDuringNativeCall = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      });

      await initializeLocalModel();

      // Marker was present during native initialization
      expect(markerPresentDuringNativeCall).not.toBeNull();
      const marker = JSON.parse(markerPresentDuringNativeCall!);
      expect(marker.backend).toBe('opencl');

      // Marker removed after successful native completion
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
      expect(await isGpuCrashFlagSet()).toBe(false);
    });

    it('should never write GPU session marker when CPU backend is used', async () => {
      useConfigStore.getState().setGpuBackendPreference('cpu');

      let markerPresentDuringNativeCall: string | null = null;
      (GemmaNative.initializeLocalModel as jest.Mock).mockImplementationOnce(async () => {
        markerPresentDuringNativeCall = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      });

      await initializeLocalModel();

      // No session marker written for CPU (prevents false positives)
      expect(markerPresentDuringNativeCall).toBeNull();
      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
    });

    it('removes the session marker on a handled JS exception (no false-positive crash next launch)', async () => {
      useConfigStore.getState().setGpuBackendPreference('opencl');
      (GemmaNative.initializeLocalModel as jest.Mock).mockRejectedValueOnce(
        new Error('Handled JS exception during init')
      );

      await initializeLocalModel();

      expect(await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY)).toBeNull();
      expect((await detectCrashedGpuInit()).crashed).toBe(false);
    });

    it('lets an explicit user GPU preference win over a persisted crash flag', async () => {
      await AsyncStorage.setItem(
        LITERT_GPU_CRASH_FLAG_KEY,
        JSON.stringify({ backend: 'opencl', modelName: 'm', timestamp: 1, consumed: false })
      );
      useConfigStore.getState().setGpuBackendPreference('opencl');
      (GemmaNative.initializeLocalModel as jest.Mock).mockResolvedValueOnce(undefined);

      await initializeLocalModel();
      expect(useConfigStore.getState().gpuBackendPreference).toBe('opencl');
    });

    it('downgrades to CPU for exactly one launch, then retries GPU', async () => {
      // Launch 1: Stale GPU marker -> crash flag detected and set (consumed: false)
      await AsyncStorage.setItem(
        LITERT_GPU_INIT_SESSION_KEY,
        JSON.stringify({
          backend: 'opencl',
          modelName: 'DeepSeek-R1 1.5B (GGUF)',
          timestamp: 1700000000000,
        })
      );
      useConfigStore.getState().setGpuBackendPreference('auto');

      let launch1MarkerDuringNativeCall: string | null = null;
      (GemmaNative.initializeLocalModel as jest.Mock).mockImplementationOnce(async () => {
        launch1MarkerDuringNativeCall = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      });

      await initializeLocalModel();

      // Launch 1 forced CPU: no GPU session marker written during native call
      expect(launch1MarkerDuringNativeCall).toBeNull();
      // Flag must still exist (so badge is visible this session) and be marked consumed
      expect(await isGpuCrashFlagSet()).toBe(true);
      const rawFlag1 = await AsyncStorage.getItem(LITERT_GPU_CRASH_FLAG_KEY);
      expect(JSON.parse(rawFlag1!).consumed).toBe(true);
      // gpuBackendPreference must NOT be overwritten to cpu in config store
      expect(useConfigStore.getState().gpuBackendPreference).toBe('auto');

      // Unload before launch 2
      await unloadLocalModel();

      // Launch 2: Flag was consumed, so flag is cleared and GPU is retried
      let launch2MarkerDuringNativeCall: string | null = null;
      (GemmaNative.initializeLocalModel as jest.Mock).mockImplementationOnce(async () => {
        launch2MarkerDuringNativeCall = await AsyncStorage.getItem(LITERT_GPU_INIT_SESSION_KEY);
      });

      await initializeLocalModel();

      // Flag was cleared
      expect(await isGpuCrashFlagSet()).toBe(false);
      // GPU was retried: GPU session marker was written during native call (opencl)
      expect(launch2MarkerDuringNativeCall).not.toBeNull();
      const marker2 = JSON.parse(launch2MarkerDuringNativeCall!);
      expect(marker2.backend).toBe('opencl');
    });
  });
});

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

import {
  initializeLocalModel,
  unloadLocalModel,
  isLocalModelLoaded,
  streamLocalLlmResponse,
  isLocalLlmDown,
  setLocalLlmDown,
} from '../utils/localLlm';

const GemmaNative = NativeModules.GemmaReactNativeModule;

describe('localLlm wrapper', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
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
});

import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockLlamaContext = {
  completion: jest.fn(),
  stopCompletion: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
};

jest.mock('llama.rn', () => ({
  initLlama: jest.fn(async () => mockLlamaContext),
  LlamaContext: jest.fn(),
}));

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

  class MockEmitter {
    addListener(_name: string, cb: (event: any) => void) {
      streamListener = cb;
      return {
        remove: () => {
          streamListener = null;
        },
      };
    }
  }

  Object.defineProperty(actual, 'NativeEventEmitter', {
    value: MockEmitter,
    writable: true,
    configurable: true,
  });

  return actual;
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

let mockNeedleListener: ((event: any) => void) | null = null;
const mockNeedleRemove = jest.fn(() => {
  mockNeedleListener = null;
});

jest.mock('../modules/needle', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(() => true),
    hasNativeLibrary: jest.fn(() => true),
    init: jest.fn(async () => true),
    complete: jest.fn(async () => ({
      text: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
      toolCalls: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
    })),
    reset: jest.fn(async () => true),
    unload: jest.fn(async () => {}),
    addListener: jest.fn((cb) => {
      mockNeedleListener = cb;
      return { remove: mockNeedleRemove };
    }),
  },
}));

import NeedleModule from '../modules/needle';
import {
  initializeLocalModel,
  unloadLocalModel,
  streamLocalLlmResponse,
  isUsingMockFallback,
} from '../utils/localLlm';
import { useConfigStore } from '../store/useConfigStore';
import { streamCloudResponse } from '../utils/providers';

const GemmaNative = NativeModules.GemmaReactNativeModule;

describe('localLlm and cloud adapter abort signals', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await unloadLocalModel();
    useConfigStore.setState({ localModelName: 'Qwen2.5 0.5B' });
  });

  afterEach(async () => {
    await unloadLocalModel();
  });

  describe('Mock generator path abort', () => {
    it('halts mock generation immediately when signal aborts mid-stream', async () => {
      // Mock mode triggered by throwOnFallback: false when file not downloaded
      await AsyncStorage.setItem(
        'local_model_downloaded_Qwen2.5 0.5B_path',
        'file:///test/mock.unknown'
      );
      await initializeLocalModel(false);

      const controller = new AbortController();
      const tokens: string[] = [];
      const onToken = jest.fn((token: string) => {
        tokens.push(token);
        if (tokens.length === 2) {
          controller.abort();
        }
      });

      const generator = streamLocalLlmResponse('Tell me a long story', onToken, controller.signal);

      for await (const chunk of generator) {
        // Consuming chunks
      }

      expect(tokens.length).toBe(2);
      expect(controller.signal.aborted).toBe(true);
    });

    it('exits immediately if signal is already aborted before starting', async () => {
      await AsyncStorage.setItem(
        'local_model_downloaded_Qwen2.5 0.5B_path',
        'file:///test/mock.unknown'
      );
      await initializeLocalModel(false);

      const controller = new AbortController();
      controller.abort();

      const onToken = jest.fn();
      const generator = streamLocalLlmResponse('Hello', onToken, controller.signal);

      const yielded: string[] = [];
      for await (const chunk of generator) {
        yielded.push(chunk);
      }

      expect(yielded.length).toBe(0);
      expect(onToken).not.toHaveBeenCalled();
    });
  });

  describe('llama.rn GGUF path abort', () => {
    beforeEach(async () => {
      await AsyncStorage.setItem(
        'local_model_downloaded_Qwen2.5 0.5B_path',
        'file:///test/model.gguf'
      );
      await initializeLocalModel();
    });

    it('calls llamaContext.stopCompletion() and halts stream when aborted', async () => {
      let tokenCallback: ((data: { token?: string }) => void) | null = null;
      let resolveCompletion: (() => void) | null = null;

      (mockLlamaContext.completion as jest.Mock).mockImplementation((_params, cb) => {
        tokenCallback = cb;
        return new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        });
      });

      const controller = new AbortController();
      const tokens: string[] = [];
      const onToken = jest.fn((t: string) => tokens.push(t));

      const generator = streamLocalLlmResponse('Prompt', onToken, controller.signal);

      const iterationPromise = (async () => {
        for await (const token of generator) {
          // iterate
        }
      })();

      // Emit first token
      (tokenCallback as any)?.({ token: 'Hello' });
      await new Promise((r) => setTimeout(r, 10));

      expect(tokens).toEqual(['Hello']);

      // Abort
      controller.abort();
      expect(mockLlamaContext.stopCompletion).toHaveBeenCalled();

      // Emit token after abort - should not be yielded or processed
      (tokenCallback as any)?.({ token: 'World' });

      (resolveCompletion as any)?.();
      await iterationPromise;

      expect(tokens).toEqual(['Hello']);
    });

    it('exits immediately if signal already aborted before starting llama completion', async () => {
      const controller = new AbortController();
      controller.abort();

      const onToken = jest.fn();
      const generator = streamLocalLlmResponse('Prompt', onToken, controller.signal);

      const tokens: string[] = [];
      for await (const t of generator) {
        tokens.push(t);
      }

      expect(tokens.length).toBe(0);
      expect(mockLlamaContext.completion).not.toHaveBeenCalled();
    });

    it('does not flip mock fallback when engine rejects due to abort', async () => {
      let rejectCompletion: ((err: Error) => void) | null = null;
      let tokenCallback: ((data: { token?: string }) => void) | null = null;

      (mockLlamaContext.completion as jest.Mock).mockImplementation((_params, cb) => {
        tokenCallback = cb;
        return new Promise<void>((_resolve, reject) => {
          rejectCompletion = reject;
        });
      });

      const controller = new AbortController();
      const onToken = jest.fn();
      const generator = streamLocalLlmResponse('Prompt', onToken, controller.signal);

      const iterationPromise = (async () => {
        for await (const t of generator) {
          // iterate
        }
      })();

      // Emit first token
      (tokenCallback as any)?.({ token: 'Hello' });
      await new Promise((r) => setTimeout(r, 10));

      expect(isUsingMockFallback()).toBe(false);

      // Abort mid-stream, which triggers engine rejection
      controller.abort();
      (rejectCompletion as any)?.(new Error('Operation aborted'));

      await iterationPromise;

      expect(isUsingMockFallback()).toBe(false);
    });
  });

  describe('Needle .cact path abort', () => {
    beforeEach(async () => {
      useConfigStore.setState({ localModelName: 'Needle-3 (20-layer)' });
      await AsyncStorage.setItem(
        'local_model_downloaded_Needle-3 (20-layer)_path',
        'file:///data/local/tmp/needle3.cact'
      );
      await initializeLocalModel();
    });

    it('removes listener and exits immediately on abort', async () => {
      (NeedleModule.complete as jest.Mock).mockReturnValue(new Promise(() => {}));

      const controller = new AbortController();
      const tokens: string[] = [];
      const onToken = jest.fn((t: string) => tokens.push(t));

      const generator = streamLocalLlmResponse('Device action', onToken, controller.signal);

      const iterationPromise = (async () => {
        for await (const t of generator) {
          tokens.push(t);
        }
      })();

      // Emit token before abort
      mockNeedleListener?.({ type: 'token', token: 'token1' });
      await new Promise((r) => setTimeout(r, 10));

      expect(tokens).toContain('token1');

      // Abort
      controller.abort();
      await iterationPromise;

      expect(mockNeedleRemove).toHaveBeenCalled();
    });
  });

  describe('GemmaNative .task path abort', () => {
    beforeEach(async () => {
      useConfigStore.setState({ localModelName: 'DeepSeek-R1 1.5B (GGUF)' });
      await AsyncStorage.setItem(
        'local_model_downloaded_DeepSeek-R1 1.5B (GGUF)_path',
        'file:///test/model.task'
      );
      (GemmaNative.initializeLocalModel as jest.Mock).mockResolvedValue(undefined);
      (GemmaNative.streamLlmResponse as jest.Mock).mockResolvedValue(undefined);
      await initializeLocalModel();
    });

    it('removes subscription and halts on abort', async () => {
      const controller = new AbortController();
      const tokens: string[] = [];
      const onToken = jest.fn((t: string) => tokens.push(t));

      const generator = streamLocalLlmResponse('Prompt', onToken, controller.signal);

      const iterationPromise = (async () => {
        for await (const t of generator) {
          tokens.push(t);
        }
      })();

      streamListener?.({ type: 'token', token: 'GemmaToken' });
      await new Promise((r) => setTimeout(r, 10));

      expect(tokens).toContain('GemmaToken');

      controller.abort();
      await iterationPromise;

      expect(streamListener).toBeNull();
    });
  });

  describe('Cloud adapter verification', () => {
    it('halts streaming when signal is aborted, without calling onDone or onError', async () => {
      const ai = require('ai');
      let streamCancelled = false;

      const spyStreamText = jest.spyOn(ai, 'streamText').mockImplementationOnce((options: any) => {
        expect(options.abortSignal).toBeDefined();
        return {
          textStream: (async function* () {
            try {
              yield 'Chunk 1';
              yield 'Chunk 2';
              yield 'Chunk 3';
            } finally {
              streamCancelled = true;
            }
          })(),
        } as any;
      });

      const controller = new AbortController();
      const tokens: string[] = [];
      const onToken = jest.fn((t: string) => {
        tokens.push(t);
        if (tokens.length === 1) {
          controller.abort();
        }
      });
      const onDone = jest.fn();
      const onError = jest.fn();

      await streamCloudResponse({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
        onToken,
        onDone,
        onError,
        signal: controller.signal,
      });

      expect(tokens).toEqual(['Chunk 1']);
      expect(onDone).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(streamCancelled).toBe(true);

      spyStreamText.mockRestore();
    });

    it('returns immediately without calling onError if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const onToken = jest.fn();
      const onDone = jest.fn();
      const onError = jest.fn();

      await streamCloudResponse({
        provider: 'openai',
        apiKey: '', // Empty key would normally trigger auth error
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
        onToken,
        onDone,
        onError,
        signal: controller.signal,
      });

      expect(onError).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    });
  });
});

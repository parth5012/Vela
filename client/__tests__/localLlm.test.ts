import { NativeModules } from 'react-native';

// Mock react-native NativeModules
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  actual.NativeModules.GemmaReactNativeModule = {
    initializeLocalModel: jest.fn(),
    unloadLocalModel: jest.fn(),
    streamLlmResponse: jest.fn()
  };
  return actual;
});

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
  beforeEach(() => {
    jest.clearAllMocks();
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
    (GemmaNative.streamLlmResponse as jest.Mock).mockImplementationOnce(
      (prompt, onToken, onDone, onError) => {
        onToken('Mocked ');
        onToken('Native ');
        onToken('Response');
        onDone();
      }
    );

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
    expect(GemmaNative.streamLlmResponse).toHaveBeenCalledWith(
      'Hello native',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('should gracefully fall back to mock helper if native streaming fails', async () => {
    (GemmaNative.initializeLocalModel as jest.Mock).mockResolvedValueOnce(undefined);
    (GemmaNative.streamLlmResponse as jest.Mock).mockImplementationOnce(
      (prompt, onToken, onDone, onError) => {
        onError('Native stream error');
      }
    );

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
    expect(joinedYielded).toContain('Gemma');
    expect(joinedYielded).toContain('running');
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
    expect(resultText).toContain('simulated local LLM response');
    expect(resultText).toContain('fallback mock mode');
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

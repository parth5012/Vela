import AsyncStorage from '@react-native-async-storage/async-storage';
import NeedleModule from '../modules/needle';
import * as configStoreModule from '../store/useConfigStore';
const useConfigStore = (configStoreModule as any).useConfigStore || (configStoreModule as any).default;
import {
  LOCAL_MODELS,
  initializeLocalModel,
  unloadLocalModel,
  isLocalModelLoaded,
  streamLocalLlmResponse,
} from '../utils/localLlm';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../modules/needle', () => {
  let streamListener: ((event: any) => void) | null = null;
  return {
    __esModule: true,
    default: {
      isAvailable: jest.fn(() => true),
      hasNativeLibrary: jest.fn(() => true),
      init: jest.fn(async () => true),
      complete: jest.fn(async (prompt: string) => ({
        text: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
        toolCalls: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
      })),
      reset: jest.fn(async () => true),
      unload: jest.fn(async () => {}),
      addListener: jest.fn((cb) => {
        streamListener = cb;
        return { remove: () => { streamListener = null; } };
      }),
      _emitStream: (event: any) => {
        if (streamListener) streamListener(event);
      },
    },
  };
});

describe('localLlm NeedleEngine (.cact) integration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await unloadLocalModel();
    useConfigStore.setState({ localModelName: 'Cactus Needle 45M' });
    await AsyncStorage.setItem(
      'local_model_downloaded_Cactus Needle 45M_path',
      'file:///data/local/tmp/needle-45m.cact'
    );
  });

  afterEach(async () => {
    await unloadLocalModel();
  });

  it('includes Cactus Needle 45M with format cact in LOCAL_MODELS', () => {
    const needleModel = LOCAL_MODELS.find((m) => m.format === 'cact');
    expect(needleModel).toBeDefined();
    expect(needleModel?.name).toBe('Cactus Needle 45M');
    expect(needleModel?.filename).toContain('.cact');
  });

  it('initializes NeedleModule when .cact model is configured', async () => {
    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);
    expect(NeedleModule.init).toHaveBeenCalledWith(
      '/data/local/tmp/needle-45m.cact',
      expect.any(Number)
    );
  });

  it('streams response and tool calls via NeedleModule', async () => {
    await initializeLocalModel();
    const generator = streamLocalLlmResponse('Read current screen');
    const tokens: string[] = [];
    for await (const token of generator) {
      tokens.push(token);
    }
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join('')).toContain('device_screen_read');
  });

  it('unloads NeedleModule and cleans up memory on unloadLocalModel()', async () => {
    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);
    await unloadLocalModel();
    expect(isLocalModelLoaded).toBe(false);
    expect(NeedleModule.unload).toHaveBeenCalled();
  });
});

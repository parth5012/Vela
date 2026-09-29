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

  it('matches the needle-45m.cact spec exactly (filename + HF URL)', () => {
    const needleModel = LOCAL_MODELS.find((m) => m.name === 'Cactus Needle 45M');
    expect(needleModel).toBeDefined();
    expect(needleModel?.filename).toBe('needle-45m.cact');
    expect(needleModel?.format).toBe('cact');
    expect(needleModel?.downloadUrl).toContain('cactus-ai/needle-45m');
    expect(needleModel?.downloadUrl.endsWith('needle-45m.cact')).toBe(true);
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

  // #295 — the native tool_call / refusal events are driven straight into the
  // stream; `complete` is parked so only the emitted events reach the consumer.
  const REAL_ENVELOPE =
    '{"type":"call","function_calls":[{"name":"device_screen_read","arguments":{}}],' +
    '"reasoning":"Need the screen first.","confidence":0.9}';
  const REAL_REFUSAL =
    '{"type":"call","function_calls":[],"reasoning":"I will not do that.","confidence":0.1}';

  async function collectEvents(events: any[]): Promise<string> {
    const generator = streamLocalLlmResponse('Read current screen');
    const tokens: string[] = [];
    const finished = (async () => {
      for await (const token of generator) {
        tokens.push(token);
      }
    })();
    // The generator body registers the NeedleModule listener synchronously on
    // its first next(), so events emitted here reach it before completion.
    for (const event of events) {
      (NeedleModule as any)._emitStream(event);
    }
    await finished;
    return tokens.join('');
  }

  it('forwards the real tool_call envelope (reasoning + confidence) into the stream', async () => {
    await initializeLocalModel();
    (NeedleModule.complete as jest.Mock).mockReturnValue(new Promise(() => {}));

    const text = await collectEvents([
      {
        type: 'tool_call',
        data: REAL_ENVELOPE,
        reasoning: 'Need the screen first.',
        confidence: 0.9,
      },
      { type: 'done' },
    ]);

    expect(text).toBe(REAL_ENVELOPE);
  });

  it('forwards an empty function_calls refusal as text, never as a tool_call', async () => {
    await initializeLocalModel();
    (NeedleModule.complete as jest.Mock).mockReturnValue(new Promise(() => {}));

    const text = await collectEvents([
      { type: 'refusal', data: REAL_REFUSAL, reasoning: 'I will not do that.', confidence: 0.1 },
      { type: 'done' },
    ]);

    expect(text).toBe(REAL_REFUSAL);
  });

  // #295 F2: a legacy/stale native build may still emit `token` and then the
  // payload event carrying the same JSON. The queued stream must contain the
  // payload exactly once, or the agent loop sees the envelope twice.
  it('queues a token + tool_call sequence exactly once', async () => {
    await initializeLocalModel();
    (NeedleModule.complete as jest.Mock).mockReturnValue(new Promise(() => {}));

    const text = await collectEvents([
      { type: 'token', token: REAL_ENVELOPE },
      {
        type: 'tool_call',
        data: REAL_ENVELOPE,
        reasoning: 'Need the screen first.',
        confidence: 0.9,
      },
      { type: 'done' },
    ]);

    expect(text.split(REAL_ENVELOPE).length - 1).toBe(1);
  });

  it('queues a token + refusal sequence exactly once', async () => {
    await initializeLocalModel();
    (NeedleModule.complete as jest.Mock).mockReturnValue(new Promise(() => {}));

    const text = await collectEvents([
      { type: 'token', token: REAL_REFUSAL },
      { type: 'refusal', data: REAL_REFUSAL, reasoning: 'I will not do that.', confidence: 0.1 },
      { type: 'done' },
    ]);

    expect(text.split(REAL_REFUSAL).length - 1).toBe(1);
  });

  it('still streams legitimately repeated plain tokens', async () => {
    await initializeLocalModel();
    (NeedleModule.complete as jest.Mock).mockReturnValue(new Promise(() => {}));

    const text = await collectEvents([
      { type: 'token', token: 'ha ' },
      { type: 'token', token: 'ha ' },
      { type: 'done' },
    ]);

    expect(text).toBe('ha ha ');
  });

  it('unloads NeedleModule and cleans up memory on unloadLocalModel()', async () => {
    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);
    await unloadLocalModel();
    expect(isLocalModelLoaded).toBe(false);
    expect(NeedleModule.unload).toHaveBeenCalled();
  });

  it('falls back to clearly-labeled mock output when Needle init fails', async () => {
    (NeedleModule.init as jest.Mock).mockRejectedValueOnce(new Error('needle lib missing'));
    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);

    const tokens: string[] = [];
    for await (const token of streamLocalLlmResponse('hello needle')) {
      tokens.push(token);
    }
    const text = tokens.join('');
    expect(text).toContain('Mock mode');
    expect(text).toContain('needle lib missing');
  });
});

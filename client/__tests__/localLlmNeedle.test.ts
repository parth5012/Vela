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
import { sniffMagicBytes } from '../utils/customModelStorage';

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
    useConfigStore.setState({ localModelName: 'Needle-2 45M' });
    await AsyncStorage.setItem(
      'local_model_downloaded_Needle-2 45M_path',
      'file:///data/local/tmp/needle2.cact'
    );
  });

  afterEach(async () => {
    await unloadLocalModel();
  });

  it('includes Needle-2 45M and Needle-3 (20-layer) with format cact in LOCAL_MODELS', () => {
    const needleModels = LOCAL_MODELS.filter((m) => m.format === 'cact');
    expect(needleModels.map((m) => m.name)).toEqual(['Needle-2 45M', 'Needle-3 (20-layer)']);
    for (const model of needleModels) {
      expect(model.filename).toContain('.cact');
    }
  });

  // #294 — researched upstream facts (issue #292): live Cactus-Compute repos,
  // exact file sizes, and config.json context (ticket text's "ctx 256" was
  // needle2's sliding window, not a context length).
  it('matches the needle2/needle3 specs exactly (filename + HF URL + size + ctx)', () => {
    const needle2 = LOCAL_MODELS.find((m) => m.name === 'Needle-2 45M');
    expect(needle2).toBeDefined();
    expect(needle2?.filename).toBe('needle2.cact');
    expect(needle2?.format).toBe('cact');
    expect(needle2?.downloadUrl).toBe(
      'https://huggingface.co/Cactus-Compute/needle2/resolve/main/needle2.cact'
    );
    expect(needle2?.size).toMatch(/GB$/);
    expect(needle2?.contextSize).toBe(2048);

    const needle3 = LOCAL_MODELS.find((m) => m.name === 'Needle-3 (20-layer)');
    expect(needle3).toBeDefined();
    expect(needle3?.filename).toBe('needle3.cact');
    expect(needle3?.format).toBe('cact');
    expect(needle3?.downloadUrl).toBe(
      'https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact'
    );
    expect(needle3?.size).toMatch(/GB$/);
    expect(needle3?.contextSize).toBe(8192);
  });

  // Guard: the old needle-45m HF repo is dead (HTTP 401). Every .cact entry
  // must resolve against the live Cactus-Compute repos instead.
  it('keeps zero references to the dead needle-45m repo (HTTP 401)', () => {
    const cactModels = LOCAL_MODELS.filter((m) => m.format === 'cact');
    expect(cactModels.length).toBeGreaterThan(0);
    for (const m of cactModels) {
      expect(m.downloadUrl.startsWith('https://huggingface.co/Cactus-Compute/')).toBe(true);
      expect(m.filename.includes('needle-45m')).toBe(false);
    }
    expect(LOCAL_MODELS.some((m) => m.downloadUrl.includes('needle-45m'))).toBe(false);
  });

  // #294 — both listings must be loadable by the shared magic-byte sniffer:
  // needle2.cact starts 83 2A E1 05 (tag 0x05E12A83), needle3.cact starts
  // 84 2A E1 05 (tag 0x05E12A84); both are declared format 'cact'.
  it('ties both needle entries to their .cact magic bytes', () => {
    expect(sniffMagicBytes(new Uint8Array([0x83, 0x2a, 0xe1, 0x05]))).toBe('cact');
    expect(sniffMagicBytes(new Uint8Array([0x84, 0x2a, 0xe1, 0x05]))).toBe('cact');
    expect(LOCAL_MODELS.find((m) => m.name === 'Needle-2 45M')?.format).toBe('cact');
    expect(LOCAL_MODELS.find((m) => m.name === 'Needle-3 (20-layer)')?.format).toBe('cact');
  });

  it('resolves useConfigStore.localModelName exactly for both needle entries', () => {
    for (const name of ['Needle-2 45M', 'Needle-3 (20-layer)']) {
      useConfigStore.setState({ localModelName: name });
      const resolved = LOCAL_MODELS.find(
        (m) => m.name === useConfigStore.getState().localModelName
      );
      expect(resolved).toBeDefined();
      expect(resolved?.format).toBe('cact');
    }
  });

  it('initializes NeedleModule when .cact model is configured', async () => {
    await initializeLocalModel();
    expect(isLocalModelLoaded).toBe(true);
    expect(NeedleModule.init).toHaveBeenCalledWith(
      '/data/local/tmp/needle2.cact',
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

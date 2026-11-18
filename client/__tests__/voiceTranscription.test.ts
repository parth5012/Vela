/**
 * WF-583: push-to-talk voice input — transcription plumbing.
 * Pure, native-independent contracts: provider endpoints, cloud upload,
 * waveform/elapsed helpers, on-device-first orchestration, and the
 * pluggable native Transcriber adapter.
 */
import type {
  Transcriber,
  TranscriberStartOptions,
  TranscriberResult,
  CloudTranscribe,
  CloudTranscriptionEndpoint,
} from '../utils/transcription/types';
import {
  CLOUD_TRANSCRIPTION_ENDPOINTS,
  getCloudTranscriptionEndpoint,
  getCloudTranscriptionProviderName,
} from '../utils/transcription/cloudProviders';
import {
  transcribeAudioCloud,
  toUploadUri,
  CloudTranscriptionError,
} from '../utils/transcription/cloudTranscriber';
import { MAX_RECORDING_MS, formatElapsed, buildWaveformLevels } from '../utils/transcription/waveform';
import { finalizeRecording, type FinalizeDeps } from '../utils/transcription/voiceInputFlow';
import { createNativeTranscriber } from '../utils/transcription/nativeTranscriber';

describe('WF-583 voice transcription', () => {
  describe('cloud provider endpoints', () => {
    it('defines whisper endpoints for OpenAI and Groq only', () => {
      expect(CLOUD_TRANSCRIPTION_ENDPOINTS.openai).toEqual({
        provider: 'OpenAI',
        model: 'whisper-1',
        url: 'https://api.openai.com/v1/audio/transcriptions',
      });
      expect(CLOUD_TRANSCRIPTION_ENDPOINTS.groq).toEqual({
        provider: 'Groq',
        model: 'whisper-large-v3',
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
      });
    });

    it('resolves supported slugs and returns null for every other provider', () => {
      expect(getCloudTranscriptionEndpoint('openai')?.model).toBe('whisper-1');
      expect(getCloudTranscriptionEndpoint('groq')?.model).toBe('whisper-large-v3');
      for (const slug of ['gemini', 'anthropic', 'openrouter', 'liquid', 'custom', 'bogus']) {
        expect(getCloudTranscriptionEndpoint(slug)).toBeNull();
        expect(getCloudTranscriptionProviderName(slug)).toBeNull();
      }
      expect(getCloudTranscriptionEndpoint(undefined)).toBeNull();
      expect(getCloudTranscriptionEndpoint(null)).toBeNull();
    });

    it('exposes a human provider name for consent copy', () => {
      expect(getCloudTranscriptionProviderName('openai')).toBe('OpenAI');
      expect(getCloudTranscriptionProviderName('groq')).toBe('Groq');
    });
  });

  describe('cloudTranscriber', () => {
    const endpoint = CLOUD_TRANSCRIPTION_ENDPOINTS.openai;
    const SECRET = 'sk-super-secret-vela-key';

    function okResponse(text: string) {
      return { ok: true, status: 200, json: async () => ({ text }) };
    }

    it('normalizes a bare native path into a file:// URI for RN multipart uploads', () => {
      expect(toUploadUri('/data/user/0/com.vela/cache/vela_voice.m4a')).toBe(
        'file:///data/user/0/com.vela/cache/vela_voice.m4a'
      );
      expect(toUploadUri('file:///audio/voice.m4a')).toBe('file:///audio/voice.m4a');
      expect(toUploadUri('content://media/external/audio/12')).toBe(
        'content://media/external/audio/12'
      );
    });

    it('posts a multipart request with the key in the header and returns the text', async () => {
      const fetchImpl = jest.fn(async (_url: string, _init: any) => okResponse('  hello from the cloud  ') as any);
      const text = await transcribeAudioCloud({
        endpoint,
        apiKey: SECRET,
        audioUri: 'file:///audio/voice.m4a',
        fetchImpl: fetchImpl as any,
      });
      expect(text).toBe('hello from the cloud');

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe(endpoint.url);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ Authorization: `Bearer ${SECRET}` });
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('model')).toBe('whisper-1');
      // The jest-expo FormData polyfill stringifies file objects; the real RN
      // bridge receives the `{ uri, name, type }` object from the source.
      expect((init.body as FormData).get('file')).toBeTruthy();
    });

    it('never includes the API key or audio bytes in error messages', async () => {
      const fetchImpl = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as any);
      await expect(
        transcribeAudioCloud({ endpoint, apiKey: SECRET, audioUri: 'file:///audio/voice.m4a', fetchImpl: fetchImpl as any })
      ).rejects.toMatchObject({ name: 'CloudTranscriptionError' });
      try {
        await transcribeAudioCloud({ endpoint, apiKey: SECRET, audioUri: 'file:///audio/voice.m4a', fetchImpl: fetchImpl as any });
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(SECRET);
        expect(msg).not.toContain('voice.m4a');
        expect(msg).toContain('401');
      }
    });

    it('fails fast without a key and rejects empty text', async () => {
      const fetchImpl = jest.fn(async () => okResponse('ok') as any);
      await expect(
        transcribeAudioCloud({ endpoint, apiKey: '', audioUri: 'file:///a', fetchImpl: fetchImpl as any })
      ).rejects.toBeInstanceOf(CloudTranscriptionError);
      expect(fetchImpl).not.toHaveBeenCalled();

      fetchImpl.mockResolvedValueOnce(okResponse('   ') as any);
      await expect(
        transcribeAudioCloud({ endpoint, apiKey: SECRET, audioUri: 'file:///a', fetchImpl: fetchImpl as any })
      ).rejects.toBeInstanceOf(CloudTranscriptionError);
    });
  });

  describe('waveform + elapsed helpers', () => {
    it('caps a recording at 60 seconds', () => {
      expect(MAX_RECORDING_MS).toBe(60_000);
    });

    it('formats elapsed time as mm:ss', () => {
      expect(formatElapsed(0)).toBe('00:00');
      expect(formatElapsed(4_999)).toBe('00:04');
      expect(formatElapsed(61_000)).toBe('01:01');
      expect(formatElapsed(-5)).toBe('00:00');
    });

    it('produces a bounded, deterministic waveform that changes over time', () => {
      const a = buildWaveformLevels(0, 16);
      const b = buildWaveformLevels(0, 16);
      expect(a).toEqual(b);
      expect(a).toHaveLength(16);
      for (const v of a) {
        expect(v).toBeGreaterThanOrEqual(0.15);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(buildWaveformLevels(900, 16)).not.toEqual(a);
    });
  });

  describe('finalizeRecording orchestration', () => {
    function makeTranscriber(result: TranscriberResult | Error): Transcriber {
      return {
        id: 'test',
        isAvailable: async () => true,
        start: async (_o: TranscriberStartOptions) => {},
        stop: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
        cancel: async () => {},
      };
    }

    function makeDeps(overrides: Partial<FinalizeDeps>): FinalizeDeps {
      return {
        transcriber: makeTranscriber({ text: 'on device text' }),
        cloudTranscribe: (async () => 'cloud text') as CloudTranscribe,
        providerSlug: 'openai',
        apiKey: SECRET_KEY,
        requestConsent: async () => true,
        ...overrides,
      };
    }
    const SECRET_KEY = 'sk-test-key';

    it('uses the on-device transcript directly when it succeeds', async () => {
      const cloud = jest.fn(async () => 'cloud');
      const consent = jest.fn(async () => true);
      const res = await finalizeRecording(makeDeps({
        transcriber: makeTranscriber({ text: 'hello on device', audioUri: 'file:///a' }),
        cloudTranscribe: cloud as any,
        requestConsent: consent,
      }));
      expect(res).toMatchObject({ text: 'hello on device', source: 'on-device' });
      expect(consent).not.toHaveBeenCalled();
      expect(cloud).not.toHaveBeenCalled();
    });

    it('only falls back to cloud after on-device failure AND explicit consent', async () => {
      const cloud = jest.fn(async () => 'cloud transcript');
      const consent = jest.fn(async () => true);
      const res = await finalizeRecording(makeDeps({
        transcriber: makeTranscriber({ text: '', audioUri: 'file:///a.m4a' }),
        cloudTranscribe: cloud as any,
        requestConsent: consent,
      }));
      expect(consent).toHaveBeenCalledWith('OpenAI');
      expect(cloud).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: SECRET_KEY,
        audioUri: 'file:///a.m4a',
      }));
      expect(res).toMatchObject({ text: 'cloud transcript', source: 'cloud' });
    });

    it('does not send audio when consent is declined', async () => {
      const cloud = jest.fn(async () => 'cloud');
      const res = await finalizeRecording(makeDeps({
        transcriber: makeTranscriber({ text: '', audioUri: 'file:///a.m4a' }),
        cloudTranscribe: cloud as any,
        requestConsent: async () => false,
      }));
      expect(cloud).not.toHaveBeenCalled();
      expect(res.source).toBe('none');
      expect(res.reason).toMatch(/declined/i);
      expect(res.audioUri).toBe('file:///a.m4a');
    });

    it('disables cloud fallback with a clear message for unsupported providers', async () => {
      const cloud = jest.fn(async () => 'cloud');
      const res = await finalizeRecording(makeDeps({
        providerSlug: 'gemini',
        transcriber: makeTranscriber({ text: '', audioUri: 'file:///a.m4a' }),
        cloudTranscribe: cloud as any,
      }));
      expect(cloud).not.toHaveBeenCalled();
      expect(res.source).toBe('none');
      expect(res.reason).toMatch(/Gemini/i);
    });

    it('disables cloud fallback when no API key is configured', async () => {
      const res = await finalizeRecording(makeDeps({
        apiKey: undefined,
        transcriber: makeTranscriber({ text: '', audioUri: 'file:///a.m4a' }),
      }));
      expect(res.source).toBe('none');
      expect(res.reason).toMatch(/API key/i);
    });

    it('disables cloud fallback when no audio was captured', async () => {
      const res = await finalizeRecording(makeDeps({
        transcriber: makeTranscriber({ text: '', audioUri: undefined }),
      }));
      expect(res.source).toBe('none');
      expect(res.reason).toMatch(/audio/i);
    });

    it('treats a thrown on-device stop as a transcription failure', async () => {
      const res = await finalizeRecording(makeDeps({
        transcriber: makeTranscriber(new Error('recognizer crashed')),
      }));
      expect(res.source).toBe('none');
    });
  });

  describe('nativeTranscriber adapter', () => {
    function fakeNative(overrides: Record<string, any> = {}): any {
      const base = {
        isSpeechRecognitionAvailable: async () => true,
        startSpeechRecognition: async () => ({ started: true }),
        stopSpeechRecognition: async () => ({ transcript: 'native text', audioUri: 'file:///a.m4a' }),
        cancelSpeechRecognition: async () => {},
        addSpeechPartialListener: async () => 'sub-1',
        removeSpeechPartialListener: async () => {},
        ...overrides,
      };
      const spied: any = {};
      for (const [key, value] of Object.entries(base)) spied[key] = jest.fn(value as any);
      return spied;
    }

    it('reports availability from the native capability probe', async () => {
      expect(await createNativeTranscriber(fakeNative()).isAvailable()).toBe(true);
      expect(await createNativeTranscriber(fakeNative({ isSpeechRecognitionAvailable: async () => false })).isAvailable()).toBe(false);
    });

    it('is unavailable without a native module', async () => {
      expect(await createNativeTranscriber(null).isAvailable()).toBe(false);
    });

    it('passes the 60s cap and forwards partials to the callback', async () => {
      let partialCb: ((t: string, f: boolean) => void) | undefined;
      let stopResolve: ((v: { transcript?: string; audioUri?: string }) => void) | undefined;
      const native = fakeNative({
        addSpeechPartialListener: async (cb: any) => { partialCb = cb; return 'sub-1'; },
        stopSpeechRecognition: async () => new Promise<{ transcript?: string; audioUri?: string }>((r) => { stopResolve = r; }),
      });
      const t = createNativeTranscriber(native);
      const onPartial = jest.fn();
      await t.start({ maxDurationMs: 60_000, language: 'en-US', onPartial });
      expect(native.startSpeechRecognition).toHaveBeenCalledWith(
        expect.objectContaining({ maxDurationMs: 60_000, language: 'en-US' })
      );
      partialCb?.('hel', false);
      expect(onPartial).toHaveBeenCalledWith('hel', false);
      const stopPromise = t.stop();
      stopResolve?.({ transcript: 'hello', audioUri: 'file:///a.m4a' });
      expect(await stopPromise).toEqual({ text: 'hello', audioUri: 'file:///a.m4a' });
      expect(native.removeSpeechPartialListener).toHaveBeenCalledWith('sub-1');
    });
  });
});

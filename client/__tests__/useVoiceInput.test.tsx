/**
 * WF-583: orchestration-level voice input tests. Drives the real hook with
 * injected transcribers so consent ordering, cancel and the push-to-talk
 * release race are pinned without any native module.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useVoiceInput, type VoiceInputOptions } from '../hooks/useVoiceInput';
import { useConfigStore } from '../store/useConfigStore';
import type { Transcriber, TranscriberResult, CloudTranscribe } from '../utils/transcription/types';

function makeTranscriber(overrides: Partial<Transcriber> = {}): Transcriber {
  return {
    id: 'test',
    isAvailable: async () => true,
    start: async () => {},
    stop: async (): Promise<TranscriberResult> => ({ text: 'on device' }),
    cancel: async () => {},
    ...overrides,
  };
}

describe('useVoiceInput', () => {
  let tree: renderer.ReactTestRenderer;
  let latest: { current: ReturnType<typeof useVoiceInput> | null };
  let onTranscript: jest.Mock;
  let transcriber: Transcriber;
  let cloud: jest.Mock & CloudTranscribe;

  // Always read the latest render's return value: the hook allocates a fresh
  // state object each render.
  const voice = () => latest.current!;

  const mount = () => {
    latest = { current: null };
    function Harness() {
      latest.current = useVoiceInput({
        onTranscript,
        transcriber,
        cloudTranscribe: cloud,
      } as VoiceInputOptions);
      return null;
    }
    act(() => {
      tree = renderer.create(<Harness />);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    onTranscript = jest.fn();
    cloud = jest.fn(async () => 'cloud text') as jest.Mock & CloudTranscribe;
    transcriber = makeTranscriber();
    useConfigStore.setState({ activeCloudProvider: 'openai', cloudApiKeys: { openai: 'sk-test-key' } });
  });

  afterEach(() => {
    act(() => tree?.unmount());
  });

  it('sends the on-device transcript straight to the editable composer', async () => {
    mount();
    await act(async () => { await voice().start(); });
    await act(async () => { await voice().stop(); });
    expect(onTranscript).toHaveBeenCalledWith('on device');
    expect(voice().state.consentProvider).toBeNull();
    expect(cloud).not.toHaveBeenCalled();
  });

  it('narrows the consent dialog to the named provider and sends audio only on accept', async () => {
    transcriber = makeTranscriber({ stop: async () => ({ text: '', audioUri: 'file:///a.m4a' }) });
    mount();
    await act(async () => { await voice().start(); });
    // stop() pauses on the consent promise; do not await it here.
    await act(async () => { void voice().stop(); await Promise.resolve(); });
    expect(voice().state.consentProvider).toBe('OpenAI');
    expect(cloud).not.toHaveBeenCalled();

    await act(async () => { voice().acceptCloud(); await Promise.resolve(); });
    await Promise.resolve();
    expect(cloud).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-test-key',
      audioUri: 'file:///a.m4a',
    }));
    expect(onTranscript).toHaveBeenCalledWith('cloud text');
  });

  it('does not upload audio when consent is declined and offers Retry', async () => {
    transcriber = makeTranscriber({ stop: async () => ({ text: '', audioUri: 'file:///a.m4a' }) });
    mount();
    await act(async () => { await voice().start(); });
    await act(async () => { void voice().stop(); await Promise.resolve(); });
    await act(async () => { voice().declineCloud(); await Promise.resolve(); });
    await Promise.resolve();
    expect(cloud).not.toHaveBeenCalled();
    expect(voice().state.failure).toMatch(/declined/i);
    expect(voice().state.canRetry).toBe(true);
  });

  it('cancel discards the recording with no transcript', async () => {
    const cancelSpy = jest.fn(async () => {});
    transcriber = makeTranscriber({ cancel: cancelSpy });
    mount();
    await act(async () => { await voice().start(); });
    await act(async () => { await voice().cancel(); });
    expect(cancelSpy).toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(voice().state.recording).toBe(false);
  });

  it('a release that arrives before start is invoked still ends the recording', async () => {
    const stopSpy = jest.fn(async (): Promise<TranscriberResult> => ({ text: '' }));
    transcriber = makeTranscriber({ stop: stopSpy });
    mount();
    // Simulates press-in -> async permission check -> press-out -> permission granted.
    await act(async () => {
      (voice() as any).beginHold();
      await (voice() as any).endHold();
    });
    await act(async () => { await voice().start(); });
    expect(stopSpy).toHaveBeenCalled();
    expect(voice().state.recording).toBe(false);
  });

  it('a release that arrives before native start resolves still stops the recording', async () => {
    let resolveStart!: () => void;
    let resolveStop!: (r: TranscriberResult) => void;
    const startPromise = new Promise<void>((resolve) => { resolveStart = resolve; });
    const stopPromise = new Promise<TranscriberResult>((resolve) => { resolveStop = resolve; });
    const stopSpy = jest.fn(() => stopPromise);
    transcriber = makeTranscriber({ start: () => startPromise, stop: stopSpy });
    mount();
    await act(async () => { void voice().start(); });
    await act(async () => { await voice().stop(); });
    await act(async () => {
      resolveStart();
      await startPromise;
      await Promise.resolve();
    });
    await act(async () => {
      resolveStop({ text: 'late transcript' });
      await stopPromise;
      await Promise.resolve();
    });
    expect(stopSpy).toHaveBeenCalled();
    expect(onTranscript).toHaveBeenCalledWith('late transcript');
  });
});

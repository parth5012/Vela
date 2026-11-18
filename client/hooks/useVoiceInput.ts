/**
 * WF-583: push-to-talk voice input state machine.
 *
 * Owns hold-to-talk recording (60s cap), on-device-first transcription,
 * per-recording cloud consent, cancel, and retry. The chat screen supplies
 * `onTranscript`; the resulting text lands in the ordinary editable composer
 * before the user sends. No floating overlay (out of scope).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfigStore } from '../store/useConfigStore';
import { nativeTranscriber } from '../utils/transcription/nativeTranscriber';
import { transcribeAudioCloud } from '../utils/transcription/cloudTranscriber';
import { finalizeRecording } from '../utils/transcription/voiceInputFlow';
import { MAX_RECORDING_MS, buildWaveformLevels } from '../utils/transcription/waveform';
import type { CloudTranscribe, Transcriber } from '../utils/transcription/types';

export interface VoiceInputOptions {
  onTranscript: (text: string) => void;
  /** Injectable so tests can drive the flow without the native module. */
  transcriber?: Transcriber;
  cloudTranscribe?: CloudTranscribe;
}

export interface VoiceInputState {
  recording: boolean;
  elapsedMs: number;
  levels: number[];
  partialText: string;
  consentProvider: string | null;
  failure: string | null;
  canRetry: boolean;
}

const INITIAL_STATE: VoiceInputState = {
  recording: false,
  elapsedMs: 0,
  levels: [],
  partialText: '',
  consentProvider: null,
  failure: null,
  canRetry: false,
};

export function useVoiceInput({
  onTranscript,
  transcriber = nativeTranscriber,
  cloudTranscribe = transcribeAudioCloud,
}: VoiceInputOptions) {
  const [state, setState] = useState<VoiceInputState>(INITIAL_STATE);
  const recordingRef = useRef(false);
  const busyRef = useRef(false);
  const startPendingRef = useRef(false);
  const releasePendingRef = useRef(false);
  // Gesture-level release: set by press-out even before start() is invoked
  // (e.g. while the permission check is still in flight), consumed by start().
  const releaseRequestedRef = useRef(false);
  const cancelledRef = useRef(false);
  const consentResolverRef = useRef<((value: boolean) => void) | null>(null);
  const retryAudioRef = useRef<string | undefined>(undefined);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const activeCloudProvider = useConfigStore((s) => s.activeCloudProvider);
  const cloudApiKeys = useConfigStore((s) => s.cloudApiKeys);

  const clearConsent = useCallback(() => {
    consentResolverRef.current = null;
    setState((s) => ({ ...s, consentProvider: null }));
  }, []);

  const requestConsent = useCallback(
    (providerName: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        consentResolverRef.current = resolve;
        setState((s) => ({ ...s, consentProvider: providerName }));
      }),
    []
  );

  const resolveWith = useCallback(
    async (result: { text: string; source: string; reason?: string; audioUri?: string }) => {
      // A cancelled recording must not surface a late transcript/failure.
      if (cancelledRef.current) return;
      onTranscript(result.text);
      retryAudioRef.current = result.source === 'none' ? result.audioUri : undefined;
      setState((s) => ({
        ...s,
        failure: result.source === 'none' ? result.reason ?? 'Transcription failed.' : null,
        canRetry: result.source === 'none' && Boolean(result.audioUri),
      }));
    },
    [onTranscript]
  );

  const finalize = useCallback(
    async (activeTranscriber: Transcriber) => {
      const apiKey = cloudApiKeys[activeCloudProvider];
      const result = await finalizeRecording({
        transcriber: activeTranscriber,
        cloudTranscribe,
        providerSlug: activeCloudProvider,
        apiKey,
        requestConsent,
      });
      await resolveWith(result);
    },
    [activeCloudProvider, cloudApiKeys, cloudTranscribe, requestConsent, resolveWith]
  );

  const stop = useCallback(async () => {
    // Push-to-talk race: the user released before native start() resolved.
    if (startPendingRef.current) {
      releasePendingRef.current = true;
      return;
    }
    if (!recordingRef.current || busyRef.current) return;
    busyRef.current = true;
    recordingRef.current = false;
    // Stop the waveform/ticker immediately: the bar must not keep running
    // while transcription or the consent dialog is pending.
    setState((s) => ({ ...s, recording: false }));
    try {
      await finalize(transcriber);
    } finally {
      busyRef.current = false;
    }
  }, [finalize, transcriber]);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (recordingRef.current || busyRef.current || startPendingRef.current) return;
    startPendingRef.current = true;
    cancelledRef.current = false;
    releasePendingRef.current = false;
    setState((s) => ({ ...s, failure: null, canRetry: false, partialText: '', elapsedMs: 0 }));
    try {
      await transcriber.start({
        maxDurationMs: MAX_RECORDING_MS,
        onPartial: (text, isFinal) =>
          setState((s) => ({ ...s, partialText: isFinal ? s.partialText : text })),
      });
      if (cancelledRef.current) return;
      recordingRef.current = true;
      setState((s) => ({ ...s, recording: true, levels: buildWaveformLevels(0) }));
      if (releasePendingRef.current || releaseRequestedRef.current) {
        releasePendingRef.current = false;
        releaseRequestedRef.current = false;
        startPendingRef.current = false;
        await stop();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not start voice input.';
      setState((s) => ({ ...s, failure: message, canRetry: false }));
      throw e;
    } finally {
      startPendingRef.current = false;
    }
  }, [stop, transcriber]);

  const cancel = useCallback(async () => {
    // Synchronous flag first: a quick re-tap must not start a new recording
    // while teardown is still in flight (CODING_STANDARDS §1).
    cancelledRef.current = true;
    startPendingRef.current = false;
    releasePendingRef.current = false;
    releaseRequestedRef.current = false;
    recordingRef.current = false;
    busyRef.current = true;
    const pendingConsent = consentResolverRef.current;
    if (pendingConsent) {
      pendingConsent(false);
      consentResolverRef.current = null;
    }
    setState((s) => ({ ...s, consentProvider: null }));
    retryAudioRef.current = undefined;
    try {
      await transcriber.cancel();
    } finally {
      busyRef.current = false;
      setState({ ...INITIAL_STATE });
    }
  }, [transcriber]);

  const acceptCloud = useCallback(() => {
    consentResolverRef.current?.(true);
    clearConsent();
  }, [clearConsent]);

  const declineCloud = useCallback(() => {
    consentResolverRef.current?.(false);
    clearConsent();
  }, [clearConsent]);

  const retry = useCallback(async () => {
    const audioUri = retryAudioRef.current;
    if (!audioUri || busyRef.current) return;
    busyRef.current = true;
    clearConsent();
    try {
      // Reuse the on-device-first flow with a stub that yields the already
      // captured audio; on-device already failed for this recording.
      const replay: Transcriber = {
        id: 'retry',
        isAvailable: async () => true,
        start: async () => {},
        stop: async () => ({ text: '', audioUri }),
        cancel: async () => {},
      };
      await finalize(replay);
    } finally {
      busyRef.current = false;
    }
  }, [clearConsent, finalize]);

  // Elapsed clock + deterministic waveform while holding. Auto-stop at 60s.
  useEffect(() => {
    if (!state.recording) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.min(MAX_RECORDING_MS, Date.now() - startedAt);
      if (elapsed >= MAX_RECORDING_MS) {
        setState((s) => ({ ...s, elapsedMs: MAX_RECORDING_MS }));
        void stopRef.current();
        return;
      }
      setState((s) => ({ ...s, elapsedMs: elapsed, levels: buildWaveformLevels(elapsed) }));
    }, 100);
    return () => clearInterval(id);
  }, [state.recording]);

  /** Press-in: record that the user is holding, before any async permission check. */
  const beginHold = useCallback(() => {
    releaseRequestedRef.current = false;
  }, []);

  /** Press-out: remember the release even if start() has not been called yet. */
  const endHold = useCallback(() => {
    releaseRequestedRef.current = true;
    void stopRef.current();
  }, []);

  return {
    state,
    start,
    stop,
    cancel,
    beginHold,
    endHold,
    acceptCloud,
    declineCloud,
    retry,
  };
}

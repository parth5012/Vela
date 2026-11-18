/**
 * WF-583: on-device Transcriber backed by the device-agent SpeechRecognizer
 * bridge. This is the adapter a future VelaVoice-SDK implementation can
 * replace — the rest of the app only depends on the `Transcriber` interface.
 */
import type { Transcriber, TranscriberResult, TranscriberStartOptions } from './types';
import DeviceAgentNative from '../../modules/device-agent';

type NativeVoice = {
  isSpeechRecognitionAvailable?: () => Promise<boolean>;
  startSpeechRecognition?: (options: { maxDurationMs: number; language?: string }) => Promise<{ started: boolean; error?: string }>;
  stopSpeechRecognition?: () => Promise<{ transcript?: string; audioUri?: string; error?: string }>;
  cancelSpeechRecognition?: () => Promise<void>;
  addSpeechPartialListener?: (cb: (text: string, isFinal: boolean) => void) => Promise<string>;
  removeSpeechPartialListener?: (id: string) => Promise<void>;
};

export function createNativeTranscriber(native: NativeVoice | null): Transcriber {
  let partialSubId: string | null = null;

  const detachPartial = async () => {
    if (partialSubId && native?.removeSpeechPartialListener) {
      try {
        await native.removeSpeechPartialListener(partialSubId);
      } catch {
        // Best-effort teardown.
      }
    }
    partialSubId = null;
  };

  return {
    id: 'android-speech-recognizer',

    async isAvailable(): Promise<boolean> {
      if (!native?.isSpeechRecognitionAvailable) return false;
      try {
        return await native.isSpeechRecognitionAvailable();
      } catch {
        return false;
      }
    },

    async start(options: TranscriberStartOptions): Promise<void> {
      if (!native?.startSpeechRecognition) {
        throw new Error('On-device speech recognition is not available on this device.');
      }
      if (native.addSpeechPartialListener && options.onPartial) {
        try {
          partialSubId = await native.addSpeechPartialListener(options.onPartial);
        } catch {
          // Partial results are best-effort; final transcript still works.
        }
      }
      const res = await native.startSpeechRecognition({
        maxDurationMs: options.maxDurationMs,
        language: options.language,
      });
      if (!res?.started) {
        await detachPartial();
        throw new Error(res?.error || 'Could not start on-device speech recognition.');
      }
    },

    async stop(): Promise<TranscriberResult> {
      try {
        const res = native?.stopSpeechRecognition
          ? await native.stopSpeechRecognition()
          : { transcript: '', audioUri: undefined };
        if (res?.error) throw new Error(res.error);
        return { text: res?.transcript ?? '', audioUri: res?.audioUri };
      } finally {
        await detachPartial();
      }
    },

    async cancel(): Promise<void> {
      try {
        if (native?.cancelSpeechRecognition) await native.cancelSpeechRecognition();
      } finally {
        await detachPartial();
      }
    },
  };
}

/** Default adapter wired to the autolinked native module (may be null in Jest/web). */
export const nativeTranscriber = createNativeTranscriber(DeviceAgentNative as NativeVoice | null);

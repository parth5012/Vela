/**
 * WF-583: on-device-first transcription orchestration.
 *
 * Pure and native-independent so the consent/privacy ordering is testable:
 * the on-device transcript always wins; cloud fallback happens only after an
 * on-device failure, a supported endpoint, a configured key, captured audio,
 * and explicit per-recording consent — in that order.
 */
import type { CloudTranscribe, CloudTranscriptionEndpoint, Transcriber } from './types';
import { getCloudTranscriptionEndpoint, getCloudTranscriptionProviderName } from './cloudProviders';

export type TranscriptionSource = 'on-device' | 'cloud' | 'none';

export interface FinalizeResult {
  text: string;
  source: TranscriptionSource;
  /** Human-readable reason when source === 'none'. */
  reason?: string;
  /** Kept so the UI can offer Retry without re-recording. */
  audioUri?: string;
}

export interface FinalizeDeps {
  transcriber: Transcriber;
  cloudTranscribe: CloudTranscribe;
  /** Active provider slug from useConfigStore. */
  providerSlug: string;
  /** API key for that provider (from the SecureStore-backed cloudApiKeys). */
  apiKey?: string;
  /** Resolves the consent dialog; true = audio may leave the device. */
  requestConsent: (providerName: string) => Promise<boolean>;
  getEndpoint?: (slug: string) => CloudTranscriptionEndpoint | null;
}

export async function finalizeRecording({
  transcriber,
  cloudTranscribe,
  providerSlug,
  apiKey,
  requestConsent,
  getEndpoint = getCloudTranscriptionEndpoint,
}: FinalizeDeps): Promise<FinalizeResult> {
  let onDevice: { text: string; audioUri?: string };
  try {
    onDevice = await transcriber.stop();
  } catch {
    onDevice = { text: '' };
  }

  if (onDevice.text.trim()) {
    return { text: onDevice.text.trim(), source: 'on-device', audioUri: onDevice.audioUri };
  }

  const audioUri = onDevice.audioUri;
  const endpoint = getEndpoint(providerSlug);
  const providerName = getCloudTranscriptionProviderName(providerSlug) ?? providerSlug;

  if (!endpoint) {
    return {
      text: '',
      source: 'none',
      reason: `Cloud transcription is not available for ${providerName}. Only OpenAI and Groq support voice fallback.`,
      audioUri,
    };
  }
  if (!apiKey) {
    return {
      text: '',
      source: 'none',
      reason: `No API key is configured for ${providerName}, so cloud transcription is unavailable.`,
      audioUri,
    };
  }
  if (!audioUri) {
    return {
      text: '',
      source: 'none',
      reason: 'No audio was captured, so cloud transcription is unavailable.',
      audioUri,
    };
  }

  const consented = await requestConsent(endpoint.provider);
  if (!consented) {
    return {
      text: '',
      source: 'none',
      reason: `Cloud transcription with ${endpoint.provider} was declined.`,
      audioUri,
    };
  }

  try {
    const text = await cloudTranscribe({ endpoint, apiKey, audioUri });
    return { text, source: 'cloud', audioUri };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cloud transcription failed.';
    return { text: '', source: 'none', reason: message, audioUri };
  }
}

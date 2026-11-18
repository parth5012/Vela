/**
 * WF-583: the only cloud providers with an audio-transcription endpoint.
 * Other configured providers get an explicit "fallback unavailable" message
 * rather than a silent failure. This never reads or stores API keys.
 */
import type { CloudTranscriptionEndpoint } from './types';

export const CLOUD_TRANSCRIPTION_ENDPOINTS: Record<string, CloudTranscriptionEndpoint> = {
  openai: {
    provider: 'OpenAI',
    model: 'whisper-1',
    url: 'https://api.openai.com/v1/audio/transcriptions',
  },
  groq: {
    provider: 'Groq',
    model: 'whisper-large-v3',
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
  },
};

export function getCloudTranscriptionEndpoint(
  slug: string | null | undefined
): CloudTranscriptionEndpoint | null {
  if (!slug) return null;
  return CLOUD_TRANSCRIPTION_ENDPOINTS[slug] ?? null;
}

export function getCloudTranscriptionProviderName(
  slug: string | null | undefined
): string | null {
  return getCloudTranscriptionEndpoint(slug)?.provider ?? null;
}

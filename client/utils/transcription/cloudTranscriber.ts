/**
 * WF-583: OpenAI-compatible audio transcription upload.
 *
 * Uses React Native's file-upload FormData shape (`{ uri, name, type }`) so no
 * audio bytes are decoded into JS memory. Errors are deliberately generic —
 * the API key and audio path are never included in a message or a log.
 */
import type { CloudTranscribeRequest } from './types';

export class CloudTranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudTranscriptionError';
  }
}

export type CloudTranscribeOptions = CloudTranscribeRequest & {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * React Native's multipart upload resolves `uri` with `Uri.parse` + a
 * ContentResolver, so a bare filesystem path (e.g. `/data/.../voice.m4a`)
 * cannot be opened. Native now returns a file:// URI; normalize defensively
 * so callers that supply a path still work.
 */
export function toUploadUri(uri: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(uri) ? uri : `file://${uri}`;
}

export async function transcribeAudioCloud({
  endpoint,
  apiKey,
  audioUri,
  fileName = 'voice-input.m4a',
  fetchImpl,
}: CloudTranscribeOptions): Promise<string> {
  if (!apiKey) {
    throw new CloudTranscriptionError('No API key is configured for cloud transcription.');
  }

  const form = new FormData();
  form.append('model', endpoint.model);
  // React Native uses a file descriptor object for multipart uploads; the
  // audio stays in native storage and is never loaded into JS as a string.
  form.append('file', { uri: toUploadUri(audioUri), name: fileName, type: 'audio/m4a' } as unknown as Blob);

  const doFetch = fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(endpoint.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new CloudTranscriptionError('Could not reach the transcription service.');
  }

  if (!response.ok) {
    // Status only — never echo the response body, key, or audio path.
    throw new CloudTranscriptionError(`The transcription service returned ${response.status}.`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new CloudTranscriptionError('The transcription service returned an unreadable response.');
  }

  const text =
    json && typeof json === 'object' && typeof (json as { text?: unknown }).text === 'string'
      ? (json as { text: string }).text.trim()
      : '';
  if (!text) {
    throw new CloudTranscriptionError('The transcription service returned no text.');
  }
  return text;
}

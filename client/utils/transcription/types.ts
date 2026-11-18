/**
 * WF-583: pluggable transcription contracts.
 *
 * Layer 4 (native modules & utilities) — must not import UI components or
 * screens. The `Transcriber` interface is deliberately narrow so a future
 * VelaVoice-SDK adapter can be dropped in without touching the chat screen:
 * it only starts a capture, stops it into a final transcript, cancels, and
 * reports availability.
 */

export interface TranscriberStartOptions {
  /** Hard stop after this many milliseconds (push-to-talk uses 60s). */
  maxDurationMs: number;
  /** Optional BCP-47 language hint. */
  language?: string;
  /** Interim results while the user is still holding. */
  onPartial?: (text: string, isFinal: boolean) => void;
}

export interface TranscriberResult {
  text: string;
  /** Native file:// URI of the captured audio, for optional cloud fallback. */
  audioUri?: string;
}

export interface Transcriber {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  start(options: TranscriberStartOptions): Promise<void>;
  stop(): Promise<TranscriberResult>;
  cancel(): Promise<void>;
}

export interface CloudTranscriptionEndpoint {
  /** Human-readable provider name, used verbatim in the consent dialog. */
  provider: string;
  model: string;
  url: string;
}

export interface CloudTranscribeRequest {
  endpoint: CloudTranscriptionEndpoint;
  apiKey: string;
  audioUri: string;
  fileName?: string;
}

export type CloudTranscribe = (req: CloudTranscribeRequest) => Promise<string>;

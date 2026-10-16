import { Subscription } from 'expo-modules-core';

export interface NeedleStreamEvent {
  type: 'token' | 'tool_call' | 'refusal' | 'done';
  token?: string;
  data?: string;
  reasoning?: string;
  confidence?: number;
}

export interface NeedleCompletionResult {
  text: string;
  toolCalls?: string;
}

export interface NeedleNative {
  isAvailable(): boolean;
  hasNativeLibrary(): boolean;
  init(
    weightsPath: string,
    contextSize?: number,
    systemPrompt?: string,
    toolIndexPath?: string,
    toolsJson?: string
  ): Promise<boolean>;
  complete(prompt: string, toolsJson?: string, maxTokens?: number): Promise<NeedleCompletionResult>;
  /** #299: needle_embed — null when unavailable (no native module / engine). */
  embed(text: string): Promise<number[] | null>;
  reset(): Promise<boolean>;
  unload(): Promise<void>;
  addListener(listener: (event: NeedleStreamEvent) => void): Subscription;
}

declare const NeedleModule: NeedleNative;
export default NeedleModule;

import { requireNativeModule, EventEmitter, Subscription } from 'expo-modules-core';

export interface NeedleStreamEvent {
  type: 'token' | 'tool_call' | 'done';
  token?: string;
  data?: string;
}

export interface NeedleCompletionResult {
  text: string;
  toolCalls?: string;
}

let nativeModule: any = null;
try {
  nativeModule = requireNativeModule('NeedleModule');
} catch {
  // Native module not available (e.g. Jest / Node / Web environment)
}

let emitter: EventEmitter | null = null;
try {
  if (nativeModule) {
    emitter = new EventEmitter(nativeModule);
  }
} catch {
  // Emitter fallback
}

export const NeedleModule = {
  isAvailable(): boolean {
    return nativeModule !== null;
  },

  hasNativeLibrary(): boolean {
    if (!nativeModule) return false;
    try {
      return Boolean(nativeModule.hasNativeLibrary());
    } catch {
      return false;
    }
  },

  async init(weightsPath: string, contextSize: number = 256, toolsJson?: string): Promise<boolean> {
    if (!nativeModule) {
      // Honest mock: no native runtime, so init reports failure and lets
      // localLlm fall back to the labeled "[Mock mode]" generator.
      return false;
    }
    return nativeModule.init(weightsPath, contextSize, toolsJson ?? '');
  },

  async complete(
    prompt: string,
    toolsJson?: string,
    maxTokens: number = 128
  ): Promise<NeedleCompletionResult> {
    if (!nativeModule) {
      const mockJson =
        '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}';
      return {
        text: `[Mock mode — the local model is NOT running] ${mockJson}`,
        toolCalls: mockJson,
      };
    }
    return nativeModule.complete(prompt, toolsJson || '', maxTokens);
  },

  async reset(): Promise<boolean> {
    if (!nativeModule) return true;
    return nativeModule.reset();
  },

  async unload(): Promise<void> {
    if (!nativeModule) return;
    return nativeModule.unload();
  },

  addListener(listener: (event: NeedleStreamEvent) => void): Subscription {
    if (!emitter) {
      return { remove: () => {} } as Subscription;
    }
    return emitter.addListener<NeedleStreamEvent>('onStream', listener);
  },
};

export default NeedleModule;

import { requireNativeModule, EventEmitter, Subscription } from 'expo-modules-core';

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

  async init(
    weightsPath: string,
    contextSize: number = 256,
    systemPrompt?: string,
    toolIndexPath?: string,
    // #298: tools_json is baked into the engine's static prefix at init —
    // the JSON-extraction screen passes the Owner's schema as the ONLY tool.
    toolsJson?: string
  ): Promise<boolean> {
    if (!nativeModule) {
      return true; // Mock mode
    }
    return nativeModule.init(
      weightsPath,
      contextSize,
      systemPrompt ?? '',
      toolIndexPath ?? '',
      toolsJson ?? ''
    );
  },

  async complete(
    prompt: string,
    toolsJson?: string,
    maxTokens: number = 128
  ): Promise<NeedleCompletionResult> {
    if (!nativeModule) {
      return {
        text: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
        toolCalls: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
      };
    }
    return nativeModule.complete(prompt, toolsJson || '', maxTokens);
  },

  async reset(): Promise<boolean> {
    if (!nativeModule) return true;
    return nativeModule.reset();
  },

  /**
   * #299: needle_embed — unit-norm vector from the confidence head's probe
   * pool of the loaded engine (NOT a contrastively trained embedding, see
   * #290). Returns null when the native module is missing (Jest/web), the
   * engine is not initialized, or the build predates Needle 3 — never a
   * fabricated vector.
   */
  async embed(text: string): Promise<number[] | null> {
    if (!nativeModule || typeof nativeModule.embed !== 'function') return null;
    if (!text) return null;
    try {
      const out = await nativeModule.embed(text);
      if (!Array.isArray(out) || out.length === 0) return null;
      return out.map((value: unknown) => Number(value));
    } catch {
      return null;
    }
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

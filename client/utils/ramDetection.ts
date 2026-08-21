import * as Device from 'expo-device';
import { Platform } from 'react-native';

export type ModelRecommendationStatus = 'recommended' | 'borderline' | 'unsupported';

export async function detectRamBytes(): Promise<number> {
  if (Platform.OS === 'web') {
    return 6 * 1024 * 1024 * 1024; // 6 GB default for web/simulation
  }
  
  try {
    const memory = Device.totalMemory;
    if (memory && memory > 0) {
      return memory;
    }
  } catch (err) {
    console.warn('[ramDetection] Failed to read totalMemory from Device api:', err);
  }
  
  return 6 * 1024 * 1024 * 1024; // fallback 6 GB if not available
}

/**
 * Maps a model name to its RAM recommendation tier.
 *
 * Model names must match `LOCAL_MODELS` in `utils/localLlm.ts` exactly.
 *
 * | Model                    | Size     | <4.5 GB   | 4.5-7.5 GB | >=7.5 GB  |
 * |--------------------------|----------|------------|------------|-----------|
 * | SmolLM 135M              | ~0.16 GB | recommended| supported*| recommended|
 * | Qwen2.5 0.5B             | ~0.52 GB | borderline | recommended| recommended|
 * | Llama 3.2 1B (GGUF)      | ~0.81 GB | unsupported| recommended| recommended|
 * | TinyLlama 1.1B           | ~1.1 GB  | unsupported| borderline | recommended|
 * | Qwen2.5 1.5B (GGUF)      | ~1.06 GB | unsupported| borderline | recommended|
 * | DeepSeek-R1 1.5B (GGUF)  | ~1.06 GB | unsupported| borderline | recommended|
 * | Qwen2.5 1.5B             | ~1.5 GB  | unsupported| borderline | recommended|
 * | DeepSeek-R1 1.5B         | ~1.9 GB  | unsupported| borderline | recommended|
 * | Phi-4 Mini (GGUF)        | ~2.5 GB  | unsupported| unsupported| recommended|
 *
 * *Mid-tier also covers task-variant names (without GGUF suffix) for 1.5B models.
 * Keep strings in sync with LOCAL_MODELS to prevent drift.
 */
export function getModelStatusForRam(modelName: string, ramBytes: number): ModelRecommendationStatus {
  const ramGB = ramBytes / (1024 * 1024 * 1024);

  if (ramGB < 4.5) {
    if (modelName === 'SmolLM 135M') return 'recommended';
    if (modelName === 'Qwen2.5 0.5B') return 'borderline';
    return 'unsupported';
  } else if (ramGB < 7.5) {
    if (modelName === 'Qwen2.5 0.5B' || modelName === 'Llama 3.2 1B (GGUF)') return 'recommended';
    if (
      modelName === 'TinyLlama 1.1B' ||
      modelName === 'Qwen2.5 1.5B (GGUF)' ||
      modelName === 'DeepSeek-R1 1.5B (GGUF)' ||
      modelName === 'Qwen2.5 1.5B' ||
      modelName === 'DeepSeek-R1 1.5B'
    ) {
      return 'borderline';
    }
    if (modelName === 'Phi-4 Mini (GGUF)') return 'unsupported';
    return 'unsupported';
  } else {
    // High tier (>= 7.5 GB) - all models are recommended, nothing is unsupported
    return 'recommended';
  }
}

/**
 * Returns optimal inference settings for the device's RAM tier.
 * - Low  (<4.5 GB):  SmolLM 135M,      ctx 1024, max 256
 * - Mid  (4.5-7.5):  Qwen2.5 0.5B,      ctx 2048, max 512
 * - High (>=7.5 GB): Qwen2.5 1.5B (GGUF), ctx 4096, max 1024
 * High-tier prefers Qwen2.5 1.5B (GGUF) (~1.06 GB) over TinyLlama 1.1B for quality at similar footprint.
 */
export function getOptimalSettingsForRam(ramBytes: number): {
  modelName: string;
  contextSize: number;
  maxTokens: number;
} {
  const ramGB = ramBytes / (1024 * 1024 * 1024);

  if (ramGB < 4.5) {
    return {
      modelName: 'SmolLM 135M',
      contextSize: 1024,
      maxTokens: 256,
    };
  } else if (ramGB < 7.5) {
    return {
      modelName: 'Qwen2.5 0.5B',
      contextSize: 2048,
      maxTokens: 512,
    };
  } else {
    return {
      modelName: 'Qwen2.5 1.5B (GGUF)',
      contextSize: 4096,
      maxTokens: 1024,
    };
  }
}

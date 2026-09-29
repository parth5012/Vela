import * as Device from 'expo-device';
import { Platform } from 'react-native';

export type ModelRecommendationStatus = 'recommended' | 'borderline' | 'unsupported';

export const FORMAT_RAM_MULTIPLIERS: Record<string, number> = {
  cact: 1.2,
  gguf: 1.35,
  task: 1.6,
};

export const KV_CACHE_BYTES_PER_TOKEN = 512;

export function calculateEstimatedPeakRam(
  modelSizeBytes: number,
  format: string,
  contextSize: number = 2048
): number {
  const normFormat = format.toLowerCase().replace(/^\./, '');
  const multiplier = FORMAT_RAM_MULTIPLIERS[normFormat] ?? 1.35;
  const kvCache = contextSize * KV_CACHE_BYTES_PER_TOKEN;
  return Math.round(modelSizeBytes * multiplier + kvCache);
}

/**
 * Size-driven tier status: peak RAM (size * FORMAT_RAM_MULTIPLIERS[format] +
 * contextSize * KV_CACHE_BYTES_PER_TOKEN) as a fraction of device RAM.
 * <50% recommended, 50-75% borderline, >75% unsupported.
 *
 * The shipping `.cact` sizes (needle2 13,737,807 B, needle3 35,335,380 B,
 * research #292) stay 'recommended' at every realistic tier — including with
 * needle3's 8192-token context (#296). No needle-specific branch is needed.
 */
export function getDynamicModelStatusForRam(
  modelSizeBytes: number,
  format: string,
  ramBytes: number,
  contextSize: number = 2048
): ModelRecommendationStatus {
  if (ramBytes <= 0) return 'borderline';
  const estimatedPeak = calculateEstimatedPeakRam(modelSizeBytes, format, contextSize);
  const ratio = estimatedPeak / ramBytes;
  if (ratio < 0.5) return 'recommended';
  if (ratio <= 0.75) return 'borderline';
  return 'unsupported';
}

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
 * | Needle-2 45M             | ~0.014 GB| recommended| recommended| recommended|
 * | Needle-3 (20-layer)      | ~0.035 GB| recommended| recommended| recommended|
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
 *
 * TODO(follow-up ladder map, after #289): only the shipping `.cact` files are
 * tiered here — `needle2.cact` (13,737,807 B) and the full 20-layer
 * `needle3.cact` (35,335,380 B), per HF trees verified in research #292.
 * The 4/8/12-layer Needle-3 ladder slices are deferred (#290) and their sizes
 * are UNVERIFIED — the upstream README's "8-29 MB" range does not match the
 * shipped 35.3 MB file (#292) and must not be encoded here. Add ladder rows to
 * this table (and lock them with tests) once real slices are published.
 */
export function getModelStatusForRam(modelName: string, ramBytes: number): ModelRecommendationStatus {
  const ramGB = ramBytes / (1024 * 1024 * 1024);

  if (ramGB < 4.5) {
    if (
      modelName === 'Needle-2 45M' ||
      modelName === 'Needle-3 (20-layer)' ||
      modelName === 'SmolLM 135M'
    )
      return 'recommended';
    if (modelName === 'Qwen2.5 0.5B') return 'borderline';
    return 'unsupported';
  } else if (ramGB < 7.5) {
    if (
      modelName === 'Needle-2 45M' ||
      modelName === 'Needle-3 (20-layer)' ||
      modelName === 'Qwen2.5 0.5B' ||
      modelName === 'Llama 3.2 1B (GGUF)'
    )
      return 'recommended';
    if (
      modelName === 'TinyLlama 1.1B' ||
      modelName === 'Qwen2.5 1.5B (GGUF)' ||
      modelName === 'DeepSeek-R1 1.5B (GGUF)' ||
      modelName === 'Qwen2.5 1.5B' ||
      modelName === 'DeepSeek-R1 1.5B'
    ) {
      return 'borderline';
    }
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
 *
 * Needle entries (Needle-2 45M / Needle-3 (20-layer)) are never returned as a
 * tier preset: they are 'recommended' on every tier via getModelStatusForRam
 * (so the picker never hides them), but this function keeps returning the chat
 * presets above. Needle session RAM is TBC (#292) — do not invent a number to
 * promote a needle row here.
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

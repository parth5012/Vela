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

export function getModelStatusForRam(modelName: string, ramBytes: number): ModelRecommendationStatus {
  const ramGB = ramBytes / (1024 * 1024 * 1024);

  if (ramGB < 4.5) {
    if (modelName === 'SmolLM 135M') return 'recommended';
    if (modelName === 'Qwen2.5 0.5B') return 'borderline';
    return 'unsupported';
  } else if (ramGB < 7.5) {
    if (modelName === 'Qwen2.5 0.5B' || modelName === 'Llama3.2 1B (GGUF)') return 'recommended';
    if (
      modelName === 'TinyLlama 1.1B' ||
      modelName === 'Qwen2.5 1.5B (GGUF)' ||
      modelName === 'DeepSeek-R1 1.5B (GGUF)'
    ) {
      return 'borderline';
    }
    return 'unsupported';
  } else {
    // High tier (>= 7.5 GB) - all models are recommended, nothing is unsupported
    return 'recommended';
  }
}

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
      modelName: 'TinyLlama 1.1B',
      contextSize: 4096,
      maxTokens: 1024,
    };
  }
}

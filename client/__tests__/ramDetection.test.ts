import { getModelStatusForRam, getOptimalSettingsForRam } from '../utils/ramDetection';

describe('ramDetection', () => {
  describe('getModelStatusForRam', () => {
    it('correctly classifies models for low memory devices (< 4.5 GB)', () => {
      const ram4GB = 4 * 1024 * 1024 * 1024;
      expect(getModelStatusForRam('SmolLM 135M', ram4GB)).toBe('recommended');
      expect(getModelStatusForRam('Qwen2.5 0.5B', ram4GB)).toBe('borderline');
      expect(getModelStatusForRam('TinyLlama 1.1B', ram4GB)).toBe('unsupported');
      expect(getModelStatusForRam('DeepSeek-R1 1.5B (GGUF)', ram4GB)).toBe('unsupported');
    });

    it('correctly classifies models for mid memory devices (4.5 - 7.5 GB)', () => {
      const ram6GB = 6 * 1024 * 1024 * 1024;
      expect(getModelStatusForRam('Qwen2.5 0.5B', ram6GB)).toBe('recommended');
      expect(getModelStatusForRam('Llama3.2 1B (GGUF)', ram6GB)).toBe('recommended');
      expect(getModelStatusForRam('TinyLlama 1.1B', ram6GB)).toBe('borderline');
      expect(getModelStatusForRam('Qwen2.5 1.5B (GGUF)', ram6GB)).toBe('borderline');
      expect(getModelStatusForRam('DeepSeek-R1 1.5B (GGUF)', ram6GB)).toBe('borderline');
      expect(getModelStatusForRam('Phi-4 Mini (GGUF)', ram6GB)).toBe('unsupported');
      expect(getModelStatusForRam('Qwen2.5 1.5B', ram6GB)).toBe('unsupported');
    });

    it('correctly classifies models for high memory devices (>= 7.5 GB)', () => {
      const ram8GB = 8 * 1024 * 1024 * 1024;
      expect(getModelStatusForRam('Phi-4 Mini (GGUF)', ram8GB)).toBe('recommended');
      expect(getModelStatusForRam('DeepSeek-R1 1.5B (GGUF)', ram8GB)).toBe('recommended');
      expect(getModelStatusForRam('Qwen2.5 1.5B', ram8GB)).toBe('recommended');
    });
  });

  describe('getOptimalSettingsForRam', () => {
    it('returns optimal settings for low memory tier', () => {
      const ram4GB = 4 * 1024 * 1024 * 1024;
      const settings = getOptimalSettingsForRam(ram4GB);
      expect(settings.modelName).toBe('SmolLM 135M');
      expect(settings.contextSize).toBe(1024);
      expect(settings.maxTokens).toBe(256);
    });

    it('returns optimal settings for mid memory tier', () => {
      const ram6GB = 6 * 1024 * 1024 * 1024;
      const settings = getOptimalSettingsForRam(ram6GB);
      expect(settings.modelName).toBe('Qwen2.5 0.5B');
      expect(settings.contextSize).toBe(2048);
      expect(settings.maxTokens).toBe(512);
    });

    it('returns optimal settings for high memory tier', () => {
      const ram8GB = 8 * 1024 * 1024 * 1024;
      const settings = getOptimalSettingsForRam(ram8GB);
      expect(settings.modelName).toBe('TinyLlama 1.1B');
      expect(settings.contextSize).toBe(4096);
      expect(settings.maxTokens).toBe(1024);
    });
  });
});

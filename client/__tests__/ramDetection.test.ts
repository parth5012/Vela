import {
  calculateEstimatedPeakRam,
  FORMAT_RAM_MULTIPLIERS,
  getDynamicModelStatusForRam,
  getModelStatusForRam,
  getOptimalSettingsForRam,
} from '../utils/ramDetection';

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
      expect(getModelStatusForRam('Llama 3.2 1B (GGUF)', ram6GB)).toBe('recommended');
      expect(getModelStatusForRam('TinyLlama 1.1B', ram6GB)).toBe('borderline');
      expect(getModelStatusForRam('Qwen2.5 1.5B (GGUF)', ram6GB)).toBe('borderline');
      expect(getModelStatusForRam('DeepSeek-R1 1.5B (GGUF)', ram6GB)).toBe('borderline');
      expect(getModelStatusForRam('Phi-4 Mini (GGUF)', ram6GB)).toBe('unsupported');
      expect(getModelStatusForRam('Qwen2.5 1.5B', ram6GB)).toBe('borderline');
      expect(getModelStatusForRam('DeepSeek-R1 1.5B', ram6GB)).toBe('borderline');
    });

    it('correctly classifies models for high memory devices (>= 7.5 GB)', () => {
      const ram8GB = 8 * 1024 * 1024 * 1024;
      expect(getModelStatusForRam('Phi-4 Mini (GGUF)', ram8GB)).toBe('recommended');
      expect(getModelStatusForRam('DeepSeek-R1 1.5B (GGUF)', ram8GB)).toBe('recommended');
      expect(getModelStatusForRam('Qwen2.5 1.5B', ram8GB)).toBe('recommended');
    });

    it("marks 'Cactus Needle 45M' as recommended on 2GB, 3GB, 4GB, 6GB, and 8GB RAM devices", () => {
      const GB = 1024 * 1024 * 1024;
      for (const ramGB of [2, 3, 4, 6, 8]) {
        expect(getModelStatusForRam('Cactus Needle 45M', ramGB * GB)).toBe('recommended');
      }
    });

    it('estimates peak RAM for .cact format with 1.2 multiplier plus KV cache', () => {
      expect(FORMAT_RAM_MULTIPLIERS.cact).toBe(1.2);
      const modelSizeBytes = 40 * 1024 * 1024; // ~40MB Needle model
      const contextSize = 2048;
      const expected = Math.round(modelSizeBytes * 1.2 + contextSize * 512);
      expect(calculateEstimatedPeakRam(modelSizeBytes, '.cact', contextSize)).toBe(expected);
      expect(calculateEstimatedPeakRam(modelSizeBytes, 'cact', contextSize)).toBe(expected);
    });

    it("rates 45MB '.cact' Needle model as 'recommended' via dynamic RAM budget", () => {
      const GB = 1024 * 1024 * 1024;
      const needle45MBytes = 45 * 1024 * 1024;
      // ~54MB peak (45MB * 1.2 + 256 * 512B KV cache) fits even a 2GB device.
      const expectedPeak = Math.round(needle45MBytes * 1.2 + 256 * 512);
      expect(calculateEstimatedPeakRam(needle45MBytes, '.cact', 256)).toBe(expectedPeak);
      for (const ramGB of [2, 3, 4, 6, 8]) {
        expect(getDynamicModelStatusForRam(needle45MBytes, '.cact', ramGB * GB, 256)).toBe(
          'recommended'
        );
      }
      // Dot-prefixed format normalizes identically.
      expect(getDynamicModelStatusForRam(needle45MBytes, 'cact', 2 * GB, 256)).toBe(
        'recommended'
      );
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
      expect(settings.modelName).toBe('Qwen2.5 1.5B (GGUF)');
      expect(settings.contextSize).toBe(4096);
      expect(settings.maxTokens).toBe(1024);
    });

    it('marks Phi-4 Mini as recommended on high memory tier', () => {
      const ram8GB = 8 * 1024 * 1024 * 1024;
      expect(getModelStatusForRam('Phi-4 Mini (GGUF)', ram8GB)).toBe('recommended');
    });
  });
});

import {
  calculateEstimatedPeakRam,
  FORMAT_RAM_MULTIPLIERS,
  getDynamicModelStatusForRam,
  getModelStatusForRam,
  getOptimalSettingsForRam,
} from '../utils/ramDetection';
import { LOCAL_MODELS } from '../utils/localLlm';

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

    it("marks 'Needle-2 45M' and 'Needle-3 (20-layer)' as recommended on 2GB, 3GB, 4GB, 6GB, and 8GB RAM devices", () => {
      const GB = 1024 * 1024 * 1024;
      for (const name of ['Needle-2 45M', 'Needle-3 (20-layer)']) {
        for (const ramGB of [2, 3, 4, 6, 8]) {
          expect(getModelStatusForRam(name, ramGB * GB)).toBe('recommended');
        }
      }
    });

    // #294 — the settings picker hides 'unsupported' rows unless
    // showUnsupportedModels is on; both needle rows must stay visible by
    // default (low tier, the 6 GB fallback tier, and the high tier).
    it('keeps both needle rows visible in the picker (never unsupported)', () => {
      const GB = 1024 * 1024 * 1024;
      for (const name of ['Needle-2 45M', 'Needle-3 (20-layer)']) {
        expect(getModelStatusForRam(name, 4 * GB)).not.toBe('unsupported');
        expect(getModelStatusForRam(name, 6 * GB)).not.toBe('unsupported');
        expect(getModelStatusForRam(name, 8 * GB)).not.toBe('unsupported');
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

    // #296 — every tier preset must itself be 'recommended' on that tier, so
    // "Apply recommendation" never proposes a row the picker would flag.
    it('returns a preset that is recommended on its own tier', () => {
      const GB = 1024 * 1024 * 1024;
      for (const ramGB of [2, 4, 6, 8]) {
        const rec = getOptimalSettingsForRam(ramGB * GB);
        expect(getModelStatusForRam(rec.modelName, ramGB * GB)).toBe('recommended');
      }
    });
  });

  // #296 — tiers for the .cact files that actually ship. Map decision #290:
  // only needle2.cact + the full 20-layer needle3.cact exist; the 8-29 MB
  // ladder slices are deferred and their sizes are UNVERIFIED (#292), so no
  // slice sizes are encoded here.
  describe('Needle shipping sizes across RAM tiers (#296)', () => {
    const GB = 1024 * 1024 * 1024;
    // Exact HF tree sizes verified in research #292 (as-of 2026-09-29):
    // needle2.cact = 13,737,807 B, needle3.cact = 35,335,380 B.
    const NEEDLE2_BYTES = 13737807;
    const NEEDLE3_BYTES = 35335380;

    it('rates the real needle2/needle3 sizes recommended on 2/4/6/8 GB devices', () => {
      for (const ramGB of [2, 4, 6, 8]) {
        // ctx per LOCAL_MODELS: needle2 2048, needle3 8192 (#292/#294).
        expect(getDynamicModelStatusForRam(NEEDLE2_BYTES, 'cact', ramGB * GB, 2048)).toBe(
          'recommended'
        );
        expect(getDynamicModelStatusForRam(NEEDLE3_BYTES, 'cact', ramGB * GB, 8192)).toBe(
          'recommended'
        );
      }
    });

    it('derives needle sizes from LOCAL_MODELS (single source of truth)', () => {
      for (const name of ['Needle-2 45M', 'Needle-3 (20-layer)']) {
        const model = LOCAL_MODELS.find((m) => m.name === name);
        expect(model).toBeDefined();
        // `size` strings are "~0.014 GB" / "~0.035 GB" — parsed as GB, never MB
        // (same digit-match the free-space guard uses at local-ai.tsx:424).
        const sizeMatch = model!.size.match(/([\d.]+)/);
        const sizeBytes = sizeMatch ? parseFloat(sizeMatch[1]) * GB : NaN;
        expect(sizeBytes).toBeGreaterThan(0);
        expect(
          getDynamicModelStatusForRam(sizeBytes, model!.format, 2 * GB, model!.contextSize)
        ).toBe('recommended');
      }
    });

    it('never hides a needle entry on the dynamic path (never unsupported)', () => {
      for (const ramGB of [2, 3, 4, 6, 8]) {
        expect(getDynamicModelStatusForRam(NEEDLE2_BYTES, 'cact', ramGB * GB, 2048)).not.toBe(
          'unsupported'
        );
        expect(getDynamicModelStatusForRam(NEEDLE3_BYTES, 'cact', ramGB * GB, 8192)).not.toBe(
          'unsupported'
        );
      }
    });
  });
});

import {
  calculateEstimatedPeakRam,
  getDynamicModelStatusForRam,
  getModelStatusForRam,
  FORMAT_RAM_MULTIPLIERS,
} from '../ramDetection';

describe('ramDetection dynamic calculation & gating', () => {
  const ONE_GB = 1024 * 1024 * 1024;

  it('calculates estimated peak RAM with format multipliers and KV cache', () => {
    const modelSize = 100 * 1024 * 1024; // 100 MB
    // .cact multiplier is 1.2
    const peakCact = calculateEstimatedPeakRam(modelSize, 'cact', 256);
    expect(peakCact).toBeGreaterThan(modelSize * 1.2);

    // .gguf multiplier is 1.35
    const peakGguf = calculateEstimatedPeakRam(modelSize, 'gguf', 256);
    expect(peakGguf).toBeGreaterThan(modelSize * 1.35);

    // .task multiplier is 1.6
    const peakTask = calculateEstimatedPeakRam(modelSize, 'task', 256);
    expect(peakTask).toBeGreaterThan(modelSize * 1.6);
  });

  it('categorizes models against RAM tiers (<50% recommended, 50-75% borderline, >75% unsupported)', () => {
    const ramBytes = 4 * ONE_GB; // 4 GB RAM

    // Peak ~ 1.2 GB (< 50% of 4GB) -> recommended
    const smallModelSize = 800 * 1024 * 1024; // ~800MB * 1.2 = ~960MB
    expect(getDynamicModelStatusForRam(smallModelSize, 'cact', ramBytes)).toBe('recommended');

    // Peak ~ 2.4 GB (60% of 4GB) -> borderline
    const midModelSize = 1800 * 1024 * 1024; // ~1.8GB * 1.35 = ~2.43GB
    expect(getDynamicModelStatusForRam(midModelSize, 'gguf', ramBytes)).toBe('borderline');

    // Peak ~ 3.3 GB (>75% of 4GB) -> unsupported
    const largeModelSize = 2500 * 1024 * 1024; // ~2.5GB * 1.6 = ~4.0GB
    expect(getDynamicModelStatusForRam(largeModelSize, 'task', ramBytes)).toBe('unsupported');
  });

  it('preserves existing static model status lookups', () => {
    expect(getModelStatusForRam('SmolLM 135M', 4 * ONE_GB)).toBe('recommended');
    expect(getModelStatusForRam('Phi-4 Mini (GGUF)', 4 * ONE_GB)).toBe('unsupported');
  });
});

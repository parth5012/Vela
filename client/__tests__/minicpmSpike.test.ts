import {
  MiniCpmSpikeRunner,
  DEFAULT_SPIKE_CONFIG,
  type NativeInferenceDriver,
} from '../spike/MiniCpmSpike';

describe('MiniCPM5-2B Prototype Spike Harness (WF-02)', () => {
  it('has correct default spike configuration matching WF-01 decisions and WF-04 feasibility', () => {
    expect(DEFAULT_SPIKE_CONFIG.modelName).toBe('MiniCPM5-2B (LiteRT)');
    expect(DEFAULT_SPIKE_CONFIG.filename).toBe('MiniCPM5-2B_int4.litertlm');
    expect(DEFAULT_SPIKE_CONFIG.format).toBe('litertlm');
    expect(DEFAULT_SPIKE_CONFIG.ramFloorGb).toBe(6);
    expect(DEFAULT_SPIKE_CONFIG.fixedPrompt).toBe(
      'Explain gravity in two sentences.'
    );
  });

  it('rejects invalid model artifact formats', async () => {
    const runner = new MiniCpmSpikeRunner();
    const result = await runner.runSpike('/data/local/tmp/invalid_model.bin');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid artifact format');
  });

  it('runs spike in simulated environment with telemetry when driver is not provided', async () => {
    const runner = new MiniCpmSpikeRunner();
    const result = await runner.runSpike(
      '/data/local/tmp/MiniCPM5-2B_int4.litertlm'
    );

    expect(result.success).toBe(true);
    expect(result.loadTimeMs).toBeGreaterThan(0);
    expect(result.tokensGenerated).toBeGreaterThan(0);
    expect(result.tokensPerSec).toBeGreaterThan(10);
    expect(result.peakRamMb).toBeLessThan(3000); // Must be within 6GB budget (<3GB RSS)
    expect(result.outputText).toContain('Gravity');
  });

  it('coordinates lifecycle and captures telemetry with custom native driver', async () => {
    const initMock = jest.fn().mockResolvedValue(true);
    const unloadMock = jest.fn().mockResolvedValue(undefined);
    const generateMock = jest.fn().mockImplementation(async (prompt, onToken) => {
      onToken('Gravity');
      onToken(' pulls.');
      return { text: 'Gravity pulls.', tokenCount: 2 };
    });
    const getMemoryMock = jest.fn().mockResolvedValue(1820);

    const mockDriver: NativeInferenceDriver = {
      init: initMock,
      generate: generateMock,
      unload: unloadMock,
      getMemoryUsageMb: getMemoryMock,
    };

    const runner = new MiniCpmSpikeRunner(DEFAULT_SPIKE_CONFIG, mockDriver);
    const result = await runner.runSpike(
      '/data/local/tmp/MiniCPM5-2B_int4.litertlm'
    );

    expect(initMock).toHaveBeenCalledWith(
      '/data/local/tmp/MiniCPM5-2B_int4.litertlm'
    );
    expect(generateMock).toHaveBeenCalled();
    expect(unloadMock).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.outputText).toBe('Gravity pulls.');
    expect(result.peakRamMb).toBe(1820);
  });
});

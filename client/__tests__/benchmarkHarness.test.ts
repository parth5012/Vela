import {
  OnDeviceBenchmarkHarness,
  BENCHMARK_PROMPTS,
  calculateMedian,
  type BenchmarkSuiteReport,
  type BenchmarkInferenceRunner,
} from '../utils/benchmarkHarness';

describe('WF-09: On-Device Benchmark Harness', () => {
  let mockInferenceRunner: BenchmarkInferenceRunner;

  beforeEach(() => {
    mockInferenceRunner = {
      runInference: jest.fn().mockImplementation(async (prompt, promptType) => {
        // Return realistic simulated metrics per prompt type
        if (promptType === 'short_chat') {
          return {
            ttftMs: 140,
            tokensGenerated: 25,
            durationMs: 1000,
            tokensPerSec: 25.0,
            peakRamMb: 1780,
            batteryDeltaPct: 0.05,
            temperatureDeltaC: 0.2,
            thermalStatus: 'nominal',
          };
        } else if (promptType === 'long_instruction') {
          return {
            ttftMs: 160,
            tokensGenerated: 120,
            durationMs: 4800,
            tokensPerSec: 25.0,
            peakRamMb: 1820,
            batteryDeltaPct: 0.15,
            temperatureDeltaC: 0.5,
            thermalStatus: 'nominal',
          };
        } else if (promptType === 'tool_call_latency') {
          return {
            ttftMs: 110,
            tokensGenerated: 18,
            durationMs: 720,
            tokensPerSec: 25.0,
            peakRamMb: 1750,
            batteryDeltaPct: 0.03,
            temperatureDeltaC: 0.1,
            thermalStatus: 'nominal',
          };
        } else {
          // long_context_summary
          return {
            ttftMs: 220,
            tokensGenerated: 60,
            durationMs: 2500,
            tokensPerSec: 24.0,
            peakRamMb: 1890,
            batteryDeltaPct: 0.12,
            temperatureDeltaC: 0.4,
            thermalStatus: 'nominal',
          };
        }
      }),
    };
  });

  describe('Benchmark Prompt Suite Specification', () => {
    it('defines fixed prompt sets covering short chat, long instruction, tool call, and long context', () => {
      const types = BENCHMARK_PROMPTS.map((p) => p.type);

      expect(types).toContain('short_chat');
      expect(types).toContain('long_instruction');
      expect(types).toContain('tool_call_latency');
      expect(types).toContain('long_context_summary');

      // Verify prompt lengths and structures
      const shortChat = BENCHMARK_PROMPTS.find((p) => p.type === 'short_chat');
      expect(shortChat?.prompt.length).toBeLessThan(100);

      const longContext = BENCHMARK_PROMPTS.find((p) => p.type === 'long_context_summary');
      expect(longContext?.prompt.length).toBeGreaterThan(500);
    });
  });

  describe('N-Repeat Median Aggregation', () => {
    it('calculates true median for odd and even length arrays', () => {
      expect(calculateMedian([10, 20, 30])).toBe(20);
      expect(calculateMedian([30, 10, 20])).toBe(20);
      expect(calculateMedian([10, 20, 30, 40])).toBe(25);
      expect(calculateMedian([5])).toBe(5);
      expect(calculateMedian([])).toBe(0);
    });
  });

  describe('Benchmark Execution & Telemetry Recording', () => {
    it('executes 3-repeat suite across all 4 prompt categories and calculates medians', async () => {
      const harness = new OnDeviceBenchmarkHarness({
        runner: mockInferenceRunner,
        runsPerPrompt: 3,
        deviceInfo: {
          model: 'Pixel 7',
          soc: 'Tensor G2',
          ramGb: 8,
        },
      });

      const report: BenchmarkSuiteReport = await harness.runSuite();

      expect(report.runsPerPrompt).toBe(3);
      expect(report.rawRuns).toHaveLength(12); // 4 prompts * 3 runs
      expect(mockInferenceRunner.runInference).toHaveBeenCalledTimes(12);

      // Verify aggregated medians for short_chat
      const shortChatAgg = report.aggregated.short_chat;
      expect(shortChatAgg.runsCount).toBe(3);
      expect(shortChatAgg.medianTtftMs).toBe(140);
      expect(shortChatAgg.medianTokensPerSec).toBe(25.0);
      expect(shortChatAgg.medianPeakRamMb).toBe(1780);

      // Verify overall summary
      expect(report.summary.overallMedianTokPerSec).toBeCloseTo(25.0, 1);
      expect(report.summary.overallPeakRamMb).toBe(1890);
    });

    it('exports clean JSON report conforming to benchmark contract', async () => {
      const harness = new OnDeviceBenchmarkHarness({
        runner: mockInferenceRunner,
        runsPerPrompt: 1,
        deviceInfo: {
          model: 'Galaxy S23',
          soc: 'Snapdragon 8 Gen 2',
          ramGb: 8,
        },
      });

      const report = await harness.runSuite();
      const json = harness.exportReportAsJson(report);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.deviceModel).toBe('Galaxy S23');
      expect(parsed.aggregated.short_chat).toBeDefined();
      expect(parsed.rawRuns).toHaveLength(4);
    });
  });
});

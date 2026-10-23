/**
 * WF-09: On-Device Benchmark Harness
 * Standardized performance, memory, and thermal profiling across fixed prompt suites.
 */

export type BenchmarkPromptType =
  | 'short_chat'
  | 'long_instruction'
  | 'tool_call_latency'
  | 'long_context_summary';

export interface BenchmarkPromptDefinition {
  type: BenchmarkPromptType;
  description: string;
  prompt: string;
}

export const BENCHMARK_PROMPTS: BenchmarkPromptDefinition[] = [
  {
    type: 'short_chat',
    description: 'Quick conversational turn to measure Time-to-First-Token (TTFT)',
    prompt: 'What is the capital of France and what is it known for?',
  },
  {
    type: 'long_instruction',
    description: 'Structured multi-step reasoning instruction measuring throughput',
    prompt:
      'Explain the difference between synchronous and asynchronous execution in Node.js. Provide 3 concrete real-world use cases where asynchronous non-blocking patterns prevent event-loop starvation, and outline common pitfalls with unhandled promise rejections.',
  },
  {
    type: 'tool_call_latency',
    description: 'Direct tool-calling request to measure structured argument extraction latency',
    prompt:
      'Set an alarm for 7:30 AM tomorrow with the label "Team Standup Meeting".',
  },
  {
    type: 'long_context_summary',
    description: 'Extended prompt (>500 chars) measuring prompt processing rate and memory overhead',
    prompt:
      'Project Status Report - Core Runtime & Engine Modernization\n\n' +
      'During Q3, the engineering team executed a comprehensive overhaul of our background sync pipeline, reducing SQLite write lock contention by transitioning the mobile database engine to Write-Ahead Logging (WAL) mode with a 5000ms busy timeout ceiling. Concurrently, we audited memory allocation patterns during active streaming generation, identifying that frequent message state reconciliations inside Zustand produced excessive GC pressure on lower-tier Android arm64-v8a devices. By implementing a frame-coalesced token queue committed at Choreographer 60Hz intervals, Dalvik PSS heap growth was capped under 1.8GB. Furthermore, on-device tool calling was isolated with strict user confirmation gates for mutating operations, ensuring that alarms, calendar events, and messages remain private and offline-first without requiring cloud round-trips.',
  },
];

export interface BenchmarkRunResult {
  ttftMs: number;
  tokensGenerated: number;
  durationMs: number;
  tokensPerSec: number;
  peakRamMb: number;
  batteryDeltaPct: number;
  temperatureDeltaC: number;
  thermalStatus: string;
}

export interface BenchmarkInferenceRunner {
  runInference(
    prompt: string,
    promptType: BenchmarkPromptType
  ): Promise<BenchmarkRunResult>;
}

export interface DeviceInfo {
  model: string;
  soc: string;
  ramGb: number;
}

export interface BenchmarkHarnessOptions {
  runner: BenchmarkInferenceRunner;
  runsPerPrompt?: number;
  deviceInfo?: DeviceInfo;
}

export interface BenchmarkRawRun extends BenchmarkRunResult {
  promptType: BenchmarkPromptType;
  runIndex: number;
}

export interface BenchmarkAggregatedMetrics {
  runsCount: number;
  medianTtftMs: number;
  medianTokensPerSec: number;
  medianPeakRamMb: number;
  medianBatteryDeltaPct: number;
  medianTemperatureDeltaC: number;
}

export interface BenchmarkSuiteReport {
  deviceModel: string;
  deviceInfo?: DeviceInfo;
  runsPerPrompt: number;
  timestamp: string;
  rawRuns: BenchmarkRawRun[];
  aggregated: Record<BenchmarkPromptType, BenchmarkAggregatedMetrics>;
  summary: {
    overallMedianTokPerSec: number;
    overallPeakRamMb: number;
  };
}

/**
 * Calculates the statistical median of a numeric array.
 */
export function calculateMedian(values: number[]): number {
  if (!values || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export class OnDeviceBenchmarkHarness {
  private runner: BenchmarkInferenceRunner;
  private runsPerPrompt: number;
  private deviceInfo?: DeviceInfo;

  constructor(options: BenchmarkHarnessOptions) {
    this.runner = options.runner;
    this.runsPerPrompt = options.runsPerPrompt ?? 3;
    this.deviceInfo = options.deviceInfo;
  }

  /**
   * Executes the full benchmark suite across all fixed prompt definitions.
   */
  public async runSuite(): Promise<BenchmarkSuiteReport> {
    const rawRuns: BenchmarkRawRun[] = [];

    for (const promptDef of BENCHMARK_PROMPTS) {
      for (let runIndex = 0; runIndex < this.runsPerPrompt; runIndex++) {
        const result = await this.runner.runInference(
          promptDef.prompt,
          promptDef.type
        );
        rawRuns.push({
          ...result,
          promptType: promptDef.type,
          runIndex,
        });
      }
    }

    const aggregated: Record<BenchmarkPromptType, BenchmarkAggregatedMetrics> = {
      short_chat: this.aggregateRunsForType(rawRuns, 'short_chat'),
      long_instruction: this.aggregateRunsForType(rawRuns, 'long_instruction'),
      tool_call_latency: this.aggregateRunsForType(rawRuns, 'tool_call_latency'),
      long_context_summary: this.aggregateRunsForType(
        rawRuns,
        'long_context_summary'
      ),
    };

    const allTokPerSec = rawRuns.map((r) => r.tokensPerSec);
    const overallPeakRam = Math.max(...rawRuns.map((r) => r.peakRamMb), 0);

    const report: BenchmarkSuiteReport = {
      deviceModel: this.deviceInfo?.model ?? 'Unknown Device',
      deviceInfo: this.deviceInfo,
      runsPerPrompt: this.runsPerPrompt,
      timestamp: new Date().toISOString(),
      rawRuns,
      aggregated,
      summary: {
        overallMedianTokPerSec: calculateMedian(allTokPerSec),
        overallPeakRamMb: overallPeakRam,
      },
    };

    return report;
  }

  /**
   * Serializes the suite report to a formatted JSON string.
   */
  public exportReportAsJson(report: BenchmarkSuiteReport): string {
    return JSON.stringify(report, null, 2);
  }

  private aggregateRunsForType(
    runs: BenchmarkRawRun[],
    type: BenchmarkPromptType
  ): BenchmarkAggregatedMetrics {
    const matching = runs.filter((r) => r.promptType === type);
    return {
      runsCount: matching.length,
      medianTtftMs: calculateMedian(matching.map((r) => r.ttftMs)),
      medianTokensPerSec: calculateMedian(matching.map((r) => r.tokensPerSec)),
      medianPeakRamMb: calculateMedian(matching.map((r) => r.peakRamMb)),
      medianBatteryDeltaPct: calculateMedian(
        matching.map((r) => r.batteryDeltaPct)
      ),
      medianTemperatureDeltaC: calculateMedian(
        matching.map((r) => r.temperatureDeltaC)
      ),
    };
  }
}

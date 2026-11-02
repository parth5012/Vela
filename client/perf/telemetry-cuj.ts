/**
 * Zero-dependency High-Resolution Telemetry for React Native / Expo
 * Designed for Vela Software Factory Tier-1 CUJ measurement.
 */

export interface CUJMetricPayload {
  metric: string;
  value: number;
  unit: 'ms' | 'commits' | 'ratio' | 'fps';
  tier: 1 | 2 | 3;
  description?: string;
  target?: number;
  tags?: Record<string, string | number>;
  timestamp?: number;
}

export interface MetricStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  unit: string;
}

export class CUJTelemetry {
  private marks: Map<string, number> = new Map();
  private measurements: CUJMetricPayload[] = [];
  private enabled: boolean = true;
  private logcatTag: string = '[VELA_PERF]';

  public configure(options: { enabled?: boolean; logcatTag?: string }): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.logcatTag !== undefined) this.logcatTag = options.logcatTag;
  }

  /**
   * Records a timestamp mark using performance.now() (or Date.now() fallback).
   */
  public mark(name: string): number {
    if (!this.enabled) return 0;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.marks.set(name, now);
    return now;
  }

  /**
   * Measures duration between startMark and endMark (or now).
   */
  public measure(
    metricName: string,
    startMark: string,
    endMark?: string,
    tier: 1 | 2 | 3 = 1,
    tags?: Record<string, string | number>
  ): number | null {
    if (!this.enabled) return null;
    const startTime = this.marks.get(startMark);
    if (startTime === undefined) {
      return null;
    }

    let endTime: number;
    if (endMark !== undefined) {
      const recordedEnd = this.marks.get(endMark);
      if (recordedEnd === undefined) {
        return null;
      }
      endTime = recordedEnd;
    } else {
      endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    const duration = Math.max(0, endTime - startTime);
    this.record({
      metric: metricName,
      value: Number(duration.toFixed(3)),
      unit: 'ms',
      tier,
      tags,
    });

    return duration;
  }

  /**
   * Records an explicit metric payload.
   */
  public record(payload: CUJMetricPayload): void {
    if (!this.enabled) return;
    const entry: CUJMetricPayload = {
      ...payload,
      timestamp: payload.timestamp || Date.now(),
    };
    this.measurements.push(entry);
    if (typeof console !== 'undefined' && console.log) {
      console.log(`${this.logcatTag} ${JSON.stringify(entry)}`);
    }
  }

  /**
   * Clears all recorded marks and measurements.
   */
  public reset(): void {
    this.marks.clear();
    this.measurements = [];
  }

  /**
   * Returns stats for all values of a given metric.
   */
  public getStats(metricName: string): MetricStats | null {
    const values = this.measurements
      .filter((m) => m.metric === metricName)
      .map((m) => m.value)
      .sort((a, b) => a - b);

    if (values.length === 0) return null;

    const count = values.length;
    const min = values[0];
    const max = values[count - 1];
    const sum = values.reduce((acc, v) => acc + v, 0);
    const mean = Number((sum / count).toFixed(3));

    const p50 = values[Math.floor(count * 0.5)];
    const p95 = values[Math.floor(count * 0.95)] ?? values[count - 1];
    const p99 = values[Math.floor(count * 0.99)] ?? values[count - 1];

    const unit = this.measurements.find((m) => m.metric === metricName)?.unit || 'ms';

    return { count, min, max, mean, p50, p95, p99, unit };
  }

  public getAllMeasurements(): CUJMetricPayload[] {
    return [...this.measurements];
  }
}

export const cujTelemetry = new CUJTelemetry();

import { useRef, useEffect } from 'react';

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

export type PerfSummary = Record<string, MetricStats>;

const RING_BUFFER_SIZE = 1024;

class PerfTracker {
  // Pre-allocated typed arrays for zero-allocation telemetry during streaming
  private timestamps: Float64Array = new Float64Array(RING_BUFFER_SIZE);
  private markIds: Int32Array = new Int32Array(RING_BUFFER_SIZE);
  private head: number = 0;
  private totalCount: number = 0;

  private nameToId: Map<string, number> = new Map();
  private idToName: string[] = [];
  private latestMarkTimes: Map<number, number> = new Map();

  private recordedMetrics: Map<string, { unit: string; values: number[] }> = new Map();

  private getOrAssignId(name: string): number {
    let id = this.nameToId.get(name);
    if (id === undefined) {
      id = this.idToName.length;
      this.nameToId.set(name, id);
      this.idToName.push(name);
    }
    return id;
  }

  public mark(name: string): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const id = this.getOrAssignId(name);

    const slot = this.head;
    this.timestamps[slot] = now;
    this.markIds[slot] = id;

    this.head = (this.head + 1) % RING_BUFFER_SIZE;
    this.totalCount++;

    this.latestMarkTimes.set(id, now);
    return now;
  }

  public measure(name: string, startMark: string, endMark?: string): number {
    const startId = this.nameToId.get(startMark);
    if (startId === undefined) {
      return -1;
    }
    const startTime = this.latestMarkTimes.get(startId);
    if (startTime === undefined) {
      return -1;
    }

    let endTime: number;
    if (endMark) {
      const endId = this.nameToId.get(endMark);
      if (endId === undefined) {
        return -1;
      }
      const recordedEnd = this.latestMarkTimes.get(endId);
      if (recordedEnd === undefined) {
        return -1;
      }
      endTime = recordedEnd;
    } else {
      endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    const duration = Math.max(0, endTime - startTime);
    this.recordMetric(name, duration, 'ms');
    return duration;
  }

  public recordMetric(metric: string, value: number, unit: string = 'ms'): void {
    let entry = this.recordedMetrics.get(metric);
    if (!entry) {
      entry = { unit, values: [] };
      this.recordedMetrics.set(metric, entry);
    }
    entry.values.push(value);
  }

  public measureMarkdownParse<T>(_content: string, parseFn: () => T): T {
    const hasHrtime = typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function';
    const start = hasHrtime
      ? process.hrtime.bigint()
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const result = parseFn();
    const duration = hasHrtime
      ? Number(process.hrtime.bigint() - (start as bigint)) / 1_000_000
      : ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - (start as number));
    this.recordMetric('stream_total_parse_ms', Math.max(0, duration), 'ms');
    return result;
  }

  public flush(): PerfSummary {
    const summary: PerfSummary = {};

    for (const [name, entry] of this.recordedMetrics.entries()) {
      const vals = [...entry.values].sort((a, b) => a - b);
      const count = vals.length;
      if (count === 0) continue;

      const sum = vals.reduce((acc, v) => acc + v, 0);
      const mean = sum / count;
      const min = vals[0];
      const max = vals[count - 1];

      const p50 = this.getPercentile(vals, 0.5);
      const p95 = this.getPercentile(vals, 0.95);
      const p99 = this.getPercentile(vals, 0.99);

      summary[name] = {
        count,
        min,
        max,
        mean,
        p50,
        p95,
        p99,
        unit: entry.unit,
      };
    }

    return summary;
  }

  private getPercentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[index];
  }

  public flushToLogcat(tag: string = 'VelaPerf'): void {
    const summary = this.flush();
    const jsonLine = JSON.stringify(summary);
    console.log(`[${tag}] ${jsonLine}`);
  }

  public reset(): void {
    this.head = 0;
    this.totalCount = 0;
    this.latestMarkTimes.clear();
    this.recordedMetrics.clear();
    this.nameToId.clear();
    this.idToName = [];
  }
}

export const perfTracker = new PerfTracker();

export function useRenderCount(componentName: string): number {
  const renders = useRef(0);
  renders.current += 1;

  useEffect(() => {
    perfTracker.recordMetric(`${componentName}_renders`, renders.current, 'commits');
  });

  return renders.current;
}

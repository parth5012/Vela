import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Client-side metrics module (WF-499-01 / WF-500).
 *
 * Provides counters, timers, and histograms backed by a bounded in-memory
 * ring buffer (last 1,000 samples, oldest eviction), persisted to
 * AsyncStorage under `vela_metrics_v1`.
 *
 * Runtime use of performance.now() is allowed for timer spans; consumers of
 * this module must never assert on wall-clock deltas in tests — assert on
 * counts, values, and events instead.
 */

export const METRICS_STORAGE_KEY = 'vela_metrics_v1';

/** Hard cap on retained samples; the oldest sample is evicted first. */
export const MAX_METRIC_SAMPLES = 1000;

export type MetricKind = 'counter' | 'timer' | 'histogram';

export interface MetricSample {
  name: string;
  kind: MetricKind;
  value: number;
  /**
   * Monotonic in-memory sequence number assigned when the sample enters the
   * buffer (not persisted; restored samples get fresh sequences). Lets
   * consumers resolve "everything added after snapshot X" reliably even when
   * the bounded buffer has evicted old entries — an index-based slice would
   * silently return the wrong range once the buffer wraps.
   */
  seq?: number;
}

export interface MetricStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
}

export interface MetricsSnapshot {
  /** Raw retained samples, oldest first. */
  samples: MetricSample[];
  /** Cumulative totals per counter name. */
  counters: Record<string, number>;
  /** Summarized stats per timer/histogram name. */
  stats: Record<string, MetricStats>;
}

/** Monotonic clock for timer spans; performance.now() when available. */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isValidNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Monotonic sequence counter for samples; watermark for window resolution. */
let sampleSeq = 0;

class MetricsBuffer {
  private samples: MetricSample[] = [];

  add(sample: MetricSample): void {
    // Assign a fresh monotonic sequence, newest = highest seq.
    const entry: MetricSample = { ...sample, seq: ++sampleSeq };
    this.samples.push(entry);
    // Oldest eviction: keep only the last MAX_METRIC_SAMPLES entries.
    while (this.samples.length > MAX_METRIC_SAMPLES) {
      this.samples.shift();
    }
  }

  list(): MetricSample[] {
    return this.samples;
  }

  clear(): void {
    this.samples = [];
  }

  /** Restore persisted samples ahead of any in-session samples; cap re-applied. */
  prepend(loaded: MetricSample[]): void {
    // Loaded samples get fresh (higher) sequences: seq is an in-session
    // watermark mechanism, not a durable ordering — windows are never resolved
    // across flush() → load() boundaries.
    this.samples.unshift(...loaded.map((s) => ({ ...s, seq: ++sampleSeq })));
    while (this.samples.length > MAX_METRIC_SAMPLES) {
      this.samples.shift();
    }
  }
}

// Single shared buffer used by all helper handles.
const buffer = new MetricsBuffer();

function sample(name: string, kind: MetricKind, value: number): void {
  buffer.add({ name, kind, value });
}

export function record(name: string, value: number): void {
  if (!isValidNumber(value)) return;
  sample(name, 'histogram', value);
}

export function counter(name: string): { inc(amount?: number): void } {
  return {
    inc(amount: number = 1): void {
      if (!isValidNumber(amount)) return;
      sample(name, 'counter', amount);
    },
  };
}

export function histogram(name: string): { observe(value: number): void } {
  return {
    observe(value: number): void {
      record(name, value);
    },
  };
}

export interface TimerHandle {
  start(): void;
  /** Stops the pending interval, records the duration sample, returns it (ms). Null when no interval is pending. */
  stop(): number | null;
}

export function timer(name: string): TimerHandle {
  let startedAt: number | null = null;
  return {
    start(): void {
      startedAt = nowMs();
    },
    stop(): number | null {
      if (startedAt === null) {
        return null;
      }
      const duration = Math.max(0, nowMs() - startedAt);
      startedAt = null;
      sample(name, 'timer', duration);
      return duration;
    },
  };
}

export function snapshot(): MetricsSnapshot {
  const counters: Record<string, number> = {};
  const buckets = new Map<string, number[]>();

  for (const s of buffer.list()) {
    if (s.kind === 'counter') {
      counters[s.name] = (counters[s.name] ?? 0) + s.value;
    } else {
      let values = buckets.get(s.name);
      if (!values) {
        values = [];
        buckets.set(s.name, values);
      }
      values.push(s.value);
    }
  }

  const stats: Record<string, MetricStats> = {};
  for (const [name, values] of buckets) {
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    stats[name] = {
      count: values.length,
      sum,
      min,
      max,
      mean: values.length > 0 ? sum / values.length : 0,
    };
  }

  return {
    samples: [...buffer.list()],
    counters,
    stats,
  };
}

/**
 * Persists the current buffer to AsyncStorage (`vela_metrics_v1`).
 * Returns false when the write could not be completed; in-memory data is unaffected.
 */
export async function flush(): Promise<boolean> {
  try {
    await AsyncStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify({ samples: buffer.list() }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Restores samples persisted by flush(). Existing in-memory samples are kept;
 * persisted samples are appended and the 1,000-sample cap is re-applied.
 * Tolerates missing or malformed stored data.
 */
export async function load(): Promise<void> {
  let loaded: unknown;
  try {
    const raw = await AsyncStorage.getItem(METRICS_STORAGE_KEY);
    if (!raw) return;
    loaded = JSON.parse(raw);
  } catch {
    return;
  }

  if (loaded && typeof loaded === 'object' && Array.isArray((loaded as { samples?: unknown }).samples)) {
    const valid = ((loaded as { samples: unknown }).samples as unknown[]).filter(
      (s): s is MetricSample =>
        Boolean(
          s &&
            typeof s === 'object' &&
            typeof (s as MetricSample).name === 'string' &&
            isValidNumber((s as MetricSample).value) &&
            isValidMetricKind((s as MetricSample).kind)
        )
    );
    buffer.prepend(valid);
  }
}

function isValidMetricKind(kind: unknown): kind is MetricKind {
  return kind === 'counter' || kind === 'timer' || kind === 'histogram';
}

/** Clears the in-memory buffer and pending timers. Storage is untouched. */
export function reset(): void {
  buffer.clear();
}

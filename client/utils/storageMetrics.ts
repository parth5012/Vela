/**
 * Storage query metrics (WF-499-06 / #505).
 *
 * Wraps expo-sqlite read queries at the repository level and records:
 *
 * - `storage.query.count` (counter): one increment per wrapped query.
 * - `storage.query.duration` (histogram, ms): runtime duration of each wrapped
 *   query.
 * - `storage.db.size.mib` (histogram): on-device SQLite file size when
 *   `recordDatabaseSizeMib()` is called explicitly (opt-in; not on the hot
 *   path).
 *
 * Recording goes through utils/metrics.ts, whose buffer persists to
 * AsyncStorage under the existing `vela_metrics_v1` key — the same shared
 * buffer as all other #499 metrics, viewed via snapshot().
 *
 * Budgets (runtime, documented): the history data path must run at most
 * `HISTORY_MAX_QUERIES` (1) queries and stay within `HISTORY_MAX_DURATION_MS`
 * (100ms); the thread-list window at most `THREAD_LIST_MAX_QUERIES` (2
 * queries). A perf harness asserts per screen transition: snapshot() before
 * the transition, then checkStorageWindow(before, after, 'history') after it
 * (see resolveStorageWindow — window membership is resolved via monotonic
 * sample sequences, robust against bounded-buffer eviction). The pure
 * checkStorageBudget() helper accepts a full snapshot or explicit counts
 * instead. Counters are cumulative across the session, so window-based
 * assertion is the recommended default.
 *
 * Instrumented query paths (repository boundary, minimal per-transition
 * reads):
 * - `chat.loadThreads`   (chatRepository.loadThreads — drawer thread-list
 *   hydration; DrawerContent itself renders from the zustand store, HTTP
 *   refresh via syncHistoryWithBackend issues no SQL)
 * - `chat.loadMessages`  (chatRepository.loadMessages — per-thread history)
 * - `checkins.loadCheckins` (checkinRepository.loadCheckins — journal history
 *   screen: its load() reads up to 30 entries in exactly 1 query)
 *
 * AsyncStorage (zustand persist) traffic is intentionally NOT instrumented:
 * it has no query model and the ticket budgets target SQLite reads.
 */

import { counter, record, type MetricsSnapshot } from './metrics';
import * as FileSystem from 'expo-file-system';

export const STORAGE_QUERY_COUNT_METRIC = 'storage.query.count';
export const STORAGE_QUERY_DURATION_METRIC = 'storage.query.duration';
export const STORAGE_DB_SIZE_METRIC = 'storage.db.size.mib';

/** History path budget: at most one SQLite query per history-resolution window. */
export const HISTORY_MAX_QUERIES = 1;
/** History path budget: runtime, ms — slowest wrapped query must stay within. */
export const HISTORY_MAX_DURATION_MS = 100;
/** Thread-list window budget: at most two SQLite queries (no N+1). */
export const THREAD_LIST_MAX_QUERIES = 2;

export type StorageScreen = 'history' | 'threadList';

export interface StorageBudgetViolations {
  queryCount: number;
  durationMaxMs: number;
  maxQueries: number;
  maxDurationMs: number;
  violations: string[];
  pass: boolean;
}

/** Monotonic clock for query spans; mirrors utils/metrics.ts. */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export interface DatabaseSizeInfo {
  hasDbFile: boolean;
  sizeBytes: number | null;
}

export type FileSystemLike = {
  documentDirectory: string | null;
  getInfoAsync(path: string, opts?: { size?: boolean }): Promise<{ exists: boolean; size?: number }>;
};

/**
 * Reads the size of the on-device SQLite file (vela.db under
 * `documentDirectory/SQLite`). The FileSystem dependency is injectable for
 * tests; defaults to expo-file-system. Returns null values outside the
 * native runtime (file missing or fs unavailable).
 */
export async function getDatabaseSize(
  fs: FileSystemLike = FileSystem as unknown as FileSystemLike
): Promise<DatabaseSizeInfo> {
  try {
    const path = `${fs.documentDirectory}SQLite/vela.db`;
    const info = await fs.getInfoAsync(path, { size: true });
    if (!info.exists) {
      return { hasDbFile: false, sizeBytes: null };
    }
    return {
      hasDbFile: true,
      sizeBytes: typeof info.size === 'number' ? info.size : null,
    };
  } catch {
    return { hasDbFile: false, sizeBytes: null };
  }
}

/**
 * Reads the SQLite file size and records `storage.db.size.mib`. Returns the
 * recorded value in MiB, or null when unavailable. Callers invoke this
 * explicitly (e.g. from a diagnostics screen or perf harness); the
 * FileSystem dependency is injectable for tests. Never recorded automatically
 * per transition.
 */
export async function recordDatabaseSizeMib(
  fs: FileSystemLike = FileSystem as unknown as FileSystemLike
): Promise<number | null> {
  const info = await getDatabaseSize(fs);
  if (!info.hasDbFile || info.sizeBytes === null) {
    return null;
  }
  const mib = info.sizeBytes / (1024 * 1024);
  record(STORAGE_DB_SIZE_METRIC, mib);
  return mib;
}

export interface StorageWindow {
  queryCount: number;
  /** storage.query.duration samples recorded inside the window (oldest first). */
  durationSamples: number[];
  durationMaxMs: number;
}

/**
 * Resolves the metric window between two snapshots (per screen transition /
 * hydration): counters are diffed, duration samples are the
 * `storage.query.duration` histogram entries appended after the baseline
 * snapshot. Pair with checkStorageBudget/checkStorageWindow to assert a
 * screen's runtime budget without resetting the shared session buffer.
 */
export function resolveStorageWindow(before: MetricsSnapshot, after: MetricsSnapshot): StorageWindow {
  // Watermark = highest sample seq present at the baseline. Samples with a
  // higher seq were recorded after the 'before' snapshot. Seq survives oldest
  // eviction (index-slicing does not: once the buffer is at its 1,000-sample
  // cap both snapshots report length 1000 and a naive slice would report an
  // empty window — silently passing the budget).
  const watermark = before.samples.reduce<number>((max, s) => Math.max(max, s.seq ?? 0), 0);
  const windowed = after.samples.filter(
    (s) => s.name === STORAGE_QUERY_DURATION_METRIC && (s.seq ?? 0) > watermark
  );
  const durationSamples = windowed.map((s) => s.value);

  // Each instrumented query records exactly one counter inc AND one duration
  // sample, so the windowed duration samples are the reliable per-window
  // query count. The counter delta is kept as a floor for mixed buffers
  // (samples evicted mid-window still lose their counter contributions —
  // counters only sum retained samples — so deltas can undercount, never
  // overcount, which max() tolerates).
  let queryCount = durationSamples.length;
  if (!durationSamples.length && !windowed.length) {
    queryCount = Math.max(
      0,
      (after.counters[STORAGE_QUERY_COUNT_METRIC] ?? 0) -
        (before.counters[STORAGE_QUERY_COUNT_METRIC] ?? 0)
    );
  }

  return {
    queryCount,
    durationSamples,
    durationMaxMs: durationSamples.length > 0 ? Math.max(...durationSamples) : 0,
  };
}

/**
 * Budget check for a snapshot window (convenience over resolveStorageWindow +
 * checkStorageBudget): capture a snapshot before the screen transition, then
 * evaluate after it with the same screen key ('history' | 'threadList').
 */
export function checkStorageWindow(
  before: MetricsSnapshot,
  after: MetricsSnapshot,
  screen: StorageScreen = 'threadList',
  thresholds: StorageBudgetOverride = {}
): StorageBudgetViolations {
  return checkStorageBudget(resolveStorageWindow(before, after), screen, thresholds);
}

/**
 * Runs one SQLite query with metrics: increments `storage.query.count`, then
 * records the elapsed `storage.query.duration` (ms) whether it succeeded or
 * failed. The wrapped function's arguments/return/error pass through
 * unchanged.
 */
export async function instrumentQuery<T>(source: string, run: () => Promise<T>): Promise<T> {
  void source; // source is documentation-only; metrics use fixed names.
  const queryCount = counter(STORAGE_QUERY_COUNT_METRIC);
  const startedAt = nowMs();
  try {
    return await run();
  } finally {
    const duration = Math.max(0, nowMs() - startedAt);
    queryCount.inc();
    record(STORAGE_QUERY_DURATION_METRIC, duration);
  }
}

export interface StorageBudgetOverride {
  maxQueries?: number;
  maxDurationMs?: number;
}

/**
 * Pure budget check for a metrics window (screens: 'history' | 'threadList').
 *
 * Accepts:
 * - a full `MetricsSnapshot` — evaluates the cumulative buffer (pair with a
 *   `metrics.reset()` right before the screen transition); or
 * - explicit counts: `{ queryCount, durationMaxMs? }` (e.g. from a
 *   per-window diff of samples).
 *
 * Defaults: history — max 1 query and 100ms runtime; threadList — max 2
 * queries (duration unrestricted). "At most" semantics: values exactly at a
 * budget pass.
 */
export function checkStorageBudget(
  input: MetricsSnapshot | { queryCount: number; durationMaxMs?: number },
  screen: StorageScreen = 'threadList',
  thresholds: StorageBudgetOverride = {}
): StorageBudgetViolations {
  const defaultMaxQueries = screen === 'history' ? HISTORY_MAX_QUERIES : THREAD_LIST_MAX_QUERIES;
  const defaultMaxDurationMs = screen === 'history' ? HISTORY_MAX_DURATION_MS : Infinity;

  const maxQueries = thresholds.maxQueries ?? defaultMaxQueries;
  const maxDurationMs = thresholds.maxDurationMs ?? defaultMaxDurationMs;

  let queryCount: number;
  let durationMaxMs: number;
  if ('counters' in input && 'stats' in input) {
    queryCount = input.counters[STORAGE_QUERY_COUNT_METRIC] ?? 0;
    durationMaxMs = input.stats[STORAGE_QUERY_DURATION_METRIC]?.max ?? 0;
  } else {
    queryCount = input.queryCount;
    durationMaxMs = input.durationMaxMs ?? 0;
  }

  const violations: string[] = [];
  if (queryCount > maxQueries) {
    violations.push(`query count ${queryCount} exceeds budget ${maxQueries} for ${screen}`);
  }
  if (durationMaxMs > maxDurationMs) {
    violations.push(
      `query duration ${durationMaxMs}ms exceeds budget ${maxDurationMs}ms for ${screen}`
    );
  }

  return {
    pass: violations.length === 0,
    queryCount,
    durationMaxMs,
    maxQueries,
    maxDurationMs,
    violations,
  };
}

/**
 * JS-thread frame/long-task metrics (WF-499-05 / #504).
 *
 * React Native has no PerformanceObserver('longtask'); JS-thread frame health
 * is approximated by driving a requestAnimationFrame loop and measuring the
 * cadence gap between successive callbacks:
 *
 * - `frames.dropped` (counter): missed frames inferred from rAF cadence gaps —
 *   a delta between callbacks larger than the expected frame interval means
 *   the JS thread did not return between one or more frames.
 * - `tasks.long.count` (counter) and `tasks.long.maxMs` (per-task durations):
 *   a cadence gap exceeding the long-task threshold (>50ms by default) means
 *   the JS thread was blocked for that long between frames — a long task.
 *   The blocking work happens *between* callbacks (the callback body itself is
 *   only the loop's own bookkeeping), so the observed gap is the only real
 *   production signal available via rAF.
 *
 * Recording goes through utils/metrics.ts; per-session tallies are also kept
 * in the session summary so budgets can be evaluated per session (the global
 * metrics buffer is cumulative across sessions). checkFrameBudget() accepts
 * either a session summary (per-session pass/fail — preferred) or a full
 * metrics snapshot (cumulative, cross-session).
 */

import { counter, record, type MetricsSnapshot } from './metrics';

export const FRAME_DROPPED_METRIC = 'frames.dropped';
export const LONG_TASK_COUNT_METRIC = 'tasks.long.count';
export const LONG_TASK_MAX_METRIC = 'tasks.long.maxMs';

/** Assumed cadence when the expected frame interval is not provided (60fps). */
export const DEFAULT_EXPECTED_FRAME_MS = 1000 / 60;
/** A rAF callback running longer than this counts as a long task on the JS thread. */
export const DEFAULT_LONG_TASK_MS = 50;

/** A delta smaller than this multiple of the expected interval is jitter, not a dropped frame. */
const DROPPED_FRAME_TOLERANCE = 1.5;

/** Default long-task budget for checkFrameBudget. */
const DEFAULT_MAX_LONG_TASK_MS = 100;

export interface FrameTrackingOptions {
  /** Expected interval between rAF callbacks in ms. Default 60fps (16.67ms). */
  expectedFrameMs?: number;
  /** Threshold above which a rAF callback counts as a long task. Default 50ms. */
  longTaskThresholdMs?: number;
}

export interface FrameTrackingSummary {
  droppedFrames: number;
  longTaskCount: number;
  longTaskMaxMs: number;
}

export interface FrameTrackingHandle {
  /** True until the session is stopped. */
  readonly active: boolean;
  /** Tallies observed so far; stable object, updated in place. */
  summary(): FrameTrackingSummary;
}

interface FrameTrackingSession extends FrameTrackingHandle {
  stop(): void;
}

export interface FrameBudgetThresholds {
  /** Max allowed dropped frames. Default 0. */
  maxDroppedFrames?: number;
  /** Max allowed long-task duration in ms (fail when max exceeds it). Default 100. */
  maxLongTaskMs?: number;
}

export interface FrameBudgetResult {
  pass: boolean;
  droppedFrames: number;
  longTaskCount: number;
  longTaskMaxMs: number;
}

/** The active session, if any; starting anew stops the previous one. */
let activeSession: FrameTrackingSession | null = null;

type ScheduleFn = (cb: () => void) => unknown;
type CancelFn = (id: unknown) => void;

/** Monotonic clock; mirrors utils/metrics.ts. */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Scheduling is rAF-based when available (device runtime, instrumented in
 * tests) and falls back to a ~16ms timer loop where rAF is absent (bare JS).
 */
function resolveScheduler(): [ScheduleFn, CancelFn] {
  const raf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  if (typeof raf === 'function') {
    const cancel = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
    return [
      (cb) => (raf as (callback: FrameRequestCallback) => number)(cb),
      (id) => cancel?.(id as number),
    ];
  }
  return [
    (cb) => setTimeout(cb, DEFAULT_EXPECTED_FRAME_MS),
    (id) => {
      clearTimeout(id as ReturnType<typeof setTimeout>);
    },
  ];
}

function startLoop(options: FrameTrackingOptions): FrameTrackingSession {
  const expectedFrameMs = options.expectedFrameMs ?? DEFAULT_EXPECTED_FRAME_MS;
  const longTaskThresholdMs = options.longTaskThresholdMs ?? DEFAULT_LONG_TASK_MS;
  const [schedule, cancel] = resolveScheduler();

  const droppedCounter = counter(FRAME_DROPPED_METRIC);
  const longTaskCounter = counter(LONG_TASK_COUNT_METRIC);

  // Stable summary object so repeated summary() calls are observable snapshots.
  const summary: FrameTrackingSummary = {
    droppedFrames: 0,
    longTaskCount: 0,
    longTaskMaxMs: 0,
  };

  let stopped = false;
  let scheduledId: unknown = null;
  let lastFrameAt: number | null = null;

  function tick(): void {
    if (stopped) return;

    const tickAt = nowMs();
    if (lastFrameAt !== null) {
      const delta = tickAt - lastFrameAt;
      if (delta > expectedFrameMs * DROPPED_FRAME_TOLERANCE) {
        // Each whole expected interval beyond the first means a missed frame.
        const missed = Math.max(1, Math.round(delta / expectedFrameMs) - 1);
        summary.droppedFrames += missed;
        droppedCounter.inc(missed);
      }
      // A cadence gap beyond the long-task threshold means the JS thread was
      // blocked for the whole gap between frames — count it as one long task.
      // (The gap is the only real long-task signal rAF exposes; the callback
      // body itself is just this loop's bookkeeping.)
      if (delta > longTaskThresholdMs) {
        summary.longTaskCount += 1;
        longTaskCounter.inc();
        record(LONG_TASK_MAX_METRIC, delta);
        if (delta > summary.longTaskMaxMs) {
          summary.longTaskMaxMs = delta;
        }
      }
    }
    lastFrameAt = tickAt;

    if (!stopped) {
      scheduledId = schedule(tick);
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (scheduledId !== null) {
      cancel(scheduledId);
      scheduledId = null;
    }
    if (activeSession === session) {
      activeSession = null;
    }
  }

  const session: FrameTrackingSession = {
    get active() {
      return !stopped;
    },
    summary() {
      return summary;
    },
    stop,
  };

  activeSession = session;
  scheduledId = schedule(tick);
  return session;
}

/**
 * Starts JS-thread frame/long-task tracking. Only one session may run at a
 * time; starting a new one stops the previous session first.
 */
export function startFrameTracking(options: FrameTrackingOptions = {}): FrameTrackingHandle {
  activeSession?.stop();
  return startLoop(options);
}

/**
 * Stops the given session (or the active one when omitted). Returns the
 * session's final tallies, or null when nothing had been running / the
 * session already stopped.
 */
export function stopFrameTracking(
  handle?: FrameTrackingHandle | null
): FrameTrackingSummary | null {
  const target = handle ?? activeSession;
  if (!target || target.active === false) {
    return null;
  }
  const summary = { ...target.summary() };
  (target as FrameTrackingSession).stop();
  return summary;
}

/**
 * Pure budget check. Passes when dropped frames are within `maxDroppedFrames`
 * (default 0) and no long task exceeded `maxLongTaskMs` (default 100ms; tasks
 * at exactly 100ms pass).
 *
 * Accepts:
 * - a per-session `FrameTrackingSummary` (from `handle.summary()` or
 *   `stopFrameTracking()`) — evaluates THAT session only, which is how a
 *   scroll/stream session reports pass/fail on itself; or
 * - a full `MetricsSnapshot` — evaluates the cumulative buffer across all
 *   sessions since app start (documented for completeness).
 */
export function checkFrameBudget(
  input: FrameTrackingSummary | MetricsSnapshot,
  thresholds: FrameBudgetThresholds = {}
): FrameBudgetResult {
  const maxDroppedFrames = thresholds.maxDroppedFrames ?? 0;
  const maxLongTaskMs = thresholds.maxLongTaskMs ?? DEFAULT_MAX_LONG_TASK_MS;

  let droppedFrames: number;
  let longTaskCount: number;
  let longTaskMaxMs: number;
  if ('droppedFrames' in input) {
    droppedFrames = input.droppedFrames;
    longTaskCount = input.longTaskCount;
    longTaskMaxMs = input.longTaskMaxMs;
  } else {
    droppedFrames = input.counters[FRAME_DROPPED_METRIC] ?? 0;
    longTaskCount = input.counters[LONG_TASK_COUNT_METRIC] ?? 0;
    longTaskMaxMs = input.stats[LONG_TASK_MAX_METRIC]?.max ?? 0;
  }

  return {
    pass: droppedFrames <= maxDroppedFrames && longTaskMaxMs <= maxLongTaskMs,
    droppedFrames,
    longTaskCount,
    longTaskMaxMs,
  };
}

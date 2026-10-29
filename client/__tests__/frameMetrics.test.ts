/**
 * Tests for JS-thread frame/long-task metrics (utils/frameMetrics.ts).
 *
 * Test discipline: rAF and performance.now() are mocked; the loop is driven
 * manually with scripted timings — all assertions are on counts, values, and
 * events. No wall-clock assertions.
 *
 * Fake-clock model: production reads performance.now() exactly once per driven
 * frame (the tick `start`). The delta between successive tick starts drives
 * BOTH dropped frames (gap > 1.5× expected interval) and long tasks
 * (gap > long-task threshold) — a blocked JS thread manifests as a cadence gap.
 * The second scripted value (tick start, end) is legacy of the harness and
 * intentionally left in place: production never reads it.
 */

import { reset, snapshot, type MetricsSnapshot } from '../utils/metrics';
import {
  FRAME_DROPPED_METRIC,
  LONG_TASK_COUNT_METRIC,
  LONG_TASK_MAX_METRIC,
  checkFrameBudget,
  startFrameTracking,
  stopFrameTracking,
} from '../utils/frameMetrics';
import type { FrameTrackingSummary } from '../utils/frameMetrics';

interface PendingFrame {
  id: number;
  cb: () => void;
}

interface RafHarness {
  requestAnimationFrame: jest.Mock<number, [(ts: number) => void]>;
  cancelAnimationFrame: jest.Mock<void, [number]>;
  /** Runs the next pending rAF callback with clock(start, end). */
  tick(start: number, end?: number): void;
  /** Number of callbacks pending the next frame. */
  pending(): number;
  restore(): void;
}

function installRafHarness(): RafHarness {
  type MockedGlobals = { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  const g = globalThis as unknown as MockedGlobals;
  const originalRaf = g.requestAnimationFrame;
  const originalCancel = g.cancelAnimationFrame;

  // performance.now() consumes these two values per driven frame.
  let clock: number[] = [];
  let nextFrameId = 0;
  let queue: PendingFrame[] = [];

  const clockSpy = jest
    .spyOn(globalThis.performance, 'now')
    .mockImplementation(() => clock.shift() ?? 0);

  const rafSpy = jest.fn((cb: () => void) => {
    const id = ++nextFrameId;
    queue.push({ id, cb });
    return id;
  });
  const cancelSpy = jest.fn((id: number) => {
    queue = queue.filter((entry) => entry.id !== id);
  });

  g.requestAnimationFrame = rafSpy;
  g.cancelAnimationFrame = cancelSpy;

  return {
    requestAnimationFrame: rafSpy as unknown as jest.Mock<number, [(ts: number) => void]>,
    cancelAnimationFrame: cancelSpy as unknown as jest.Mock<void, [number]>,
    tick(start, end = start) {
      const entry = queue.shift();
      if (!entry) throw new Error('no pending rAF callback');
      clock = [start, end];
      entry.cb();
      clock = [];
    },
    pending() {
      return queue.length;
    },
    restore() {
      clockSpy.mockRestore();
      g.requestAnimationFrame = originalRaf;
      g.cancelAnimationFrame = originalCancel;
    },
  };
}

describe('frameMetrics', () => {
  let raf: RafHarness;

  beforeEach(() => {
    reset();
    raf = installRafHarness();
  });

  afterEach(() => {
    raf.restore();
  });

  describe('startFrameTracking / stopFrameTracking', () => {
    it('installs exactly one rAF callback per frame and reschedules forever', () => {
      startFrameTracking({ expectedFrameMs: 16 });

      expect(raf.pending()).toBe(1);
      expect(raf.requestAnimationFrame).toHaveBeenCalledTimes(1);

      raf.tick(0, 0);
      expect(raf.pending()).toBe(1);
      expect(raf.requestAnimationFrame).toHaveBeenCalledTimes(2);

      raf.tick(8, 8);
      raf.tick(16, 16);
      expect(raf.requestAnimationFrame).toHaveBeenCalledTimes(4);

      stopFrameTracking();
    });

    it('stop cancels the pending frame so no further callbacks run', () => {
      const session = startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0, 16); // frame 1: delta none, duration 16ms (ok)
      expect(raf.pending()).toBe(1);

      stopFrameTracking(session);

      expect(raf.cancelAnimationFrame).toHaveBeenCalledTimes(1);
      expect(raf.pending()).toBe(0);
      expect(raf.requestAnimationFrame).toHaveBeenCalledTimes(2);

      // Nothing was scheduled after stop; nothing can be driven further.
      expect(() => raf.tick(32, 32)).toThrow('no pending rAF callback');
      const snap = snapshot();
      expect(snap.counters[FRAME_DROPPED_METRIC]).toBeUndefined();
      expect(snap.counters[LONG_TASK_COUNT_METRIC]).toBeUndefined();
    });

    it('stop without a handle stops the active session and returns its summary', () => {
      startFrameTracking({ expectedFrameMs: 16 });
      raf.tick(0, 1); // fast frame, no delta yet

      const summary = stopFrameTracking();
      expect(summary).toEqual({ droppedFrames: 0, longTaskCount: 0, longTaskMaxMs: 0 });
    });

    it('stop with an explicit handle returns that session and a second stop returns null', () => {
      const session = startFrameTracking({ expectedFrameMs: 16 });

      const first = stopFrameTracking(session);
      expect(first).toEqual({ droppedFrames: 0, longTaskCount: 0, longTaskMaxMs: 0 });

      const second = stopFrameTracking(session);
      expect(second).toBeNull();
    });

    it('live summary() reflects tallies while the loop keeps running', () => {
      const session = startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0, 0); // first frame: baseline only
      expect(session.summary()).toEqual({ droppedFrames: 0, longTaskCount: 0, longTaskMaxMs: 0 });

      raf.tick(16, 16); // delta 16 within the interval
      expect(session.summary().droppedFrames).toBe(0);

      raf.tick(64, 64); // delta 48 => 2 missed frames
      expect(session.summary().droppedFrames).toBe(2);

      stopFrameTracking(session);
    });
  });

  describe('dropped frame detection', () => {
    it('counts deltas within the expected interval as no dropped frames', () => {
      startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0, 5);
      raf.tick(5, 10);
      raf.tick(10, 10.67);

      expect(snapshot().counters[FRAME_DROPPED_METRIC]).toBeUndefined();
      stopFrameTracking();
    });

    it('counts missed frames from rAF cadence gaps into frames.dropped', () => {
      startFrameTracking({ expectedFrameMs: 17 });

      raf.tick(0); // baseline
      raf.tick(10); // delta 10 (ok)
      raf.tick(77); // delta 67 => round(67/17) = 4 => 3 dropped; also 67ms gap > 50ms long-task threshold => 1 long task

      expect(snapshot().counters[FRAME_DROPPED_METRIC]).toBe(3);
      expect(snapshot().counters[LONG_TASK_COUNT_METRIC]).toBe(1);
      stopFrameTracking();
    });

    it('does not count a barely-late delta as a dropped frame (tolerance)', () => {
      startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0, 21); // baseline, duration ok
      raf.tick(20, 21); // delta 20 vs tolerance 24 => jitter, not a dropped frame

      expect(snapshot().counters[FRAME_DROPPED_METRIC]).toBeUndefined();
      stopFrameTracking();
    });
  });

  describe('long task detection', () => {
    it('counts cadence gaps exceeding the threshold (>50ms) into tasks.long.*', () => {
      const session = startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0); // baseline
      raf.tick(0.1); // delta 0.1 (ok)
      raf.tick(61.1); // delta 61 > 50ms => long task; also dropped frames

      expect(session.summary().longTaskCount).toBe(1);
      expect(session.summary().longTaskMaxMs).toBe(61);

      const snap = snapshot();
      expect(snap.counters[LONG_TASK_COUNT_METRIC]).toBe(1);
      expect(snap.stats[LONG_TASK_MAX_METRIC]?.max).toBe(61);
      stopFrameTracking(session);
    });

    it('a blocked JS thread manifests as BOTH a dropped frame and a long task', () => {
      startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0); // baseline
      raf.tick(80); // delta 80 => round(80/16) - 1 = 4 dropped AND one 80ms long task

      const snap = snapshot();
      expect(snap.counters[FRAME_DROPPED_METRIC]).toBe(4);
      expect(snap.counters[LONG_TASK_COUNT_METRIC]).toBe(1);
      expect(snap.stats[LONG_TASK_MAX_METRIC]?.max).toBe(80);
      stopFrameTracking();
    });

    it('is not triggered by a gap at exactly the threshold (50ms)', () => {
      const session = startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0); // baseline
      raf.tick(50); // delta exactly 50ms => not > threshold

      expect(session.summary().longTaskCount).toBe(0);
      stopFrameTracking(session);
    });

    it('records tasks.long.maxMs as max across multiple long tasks and counts each', () => {
      const session = startFrameTracking({ expectedFrameMs: 5000 });

      raf.tick(0); // baseline
      raf.tick(75); // gap 75ms => long
      raf.tick(120); // gap 45ms (ok)
      raf.tick(199); // gap 79ms => long
      raf.tick(250); // gap 51ms => long

      const snap = snapshot();
      expect(snap.counters[LONG_TASK_COUNT_METRIC]).toBe(3);
      expect(snap.stats[LONG_TASK_MAX_METRIC]?.max).toBe(79);
      expect(snap.counters[FRAME_DROPPED_METRIC]).toBeUndefined();
      expect(session.summary().longTaskCount).toBe(3);
      expect(session.summary().longTaskMaxMs).toBe(79);
      stopFrameTracking(session);
    });

    it('records no tasks.long samples when every frame cadence is fast', () => {
      startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0);
      raf.tick(1);
      raf.tick(3);

      const snap = snapshot();
      expect(snap.counters[LONG_TASK_COUNT_METRIC]).toBeUndefined();
      expect(snap.stats[LONG_TASK_MAX_METRIC]).toBeUndefined();
      stopFrameTracking();
    });
  });

  describe('checkFrameBudget', () => {
    it('passes an empty snapshot (no dropped frames, no long tasks)', () => {
      expect(checkFrameBudget(snapshot())).toEqual({
        pass: true,
        droppedFrames: 0,
        longTaskCount: 0,
        longTaskMaxMs: 0,
      });
    });

    it('fails when dropped frames exceed zero', () => {
      const snap = snapshot();
      snap.counters[FRAME_DROPPED_METRIC] = 2;

      const result = checkFrameBudget(snap);
      expect(result.pass).toBe(false);
      expect(result.droppedFrames).toBe(2);
    });

    it('fails when a long task max exceeds 100ms', () => {
      const snap = snapshot();
      snap.counters[LONG_TASK_COUNT_METRIC] = 1;
      snap.stats[LONG_TASK_MAX_METRIC] = { count: 1, sum: 120, min: 120, max: 120, mean: 120 };

      expect(checkFrameBudget(snap).pass).toBe(false);
    });

    it('passes when the max long task is exactly 100ms (budget is > 100ms)', () => {
      const snap = snapshot();
      snap.counters[LONG_TASK_COUNT_METRIC] = 1;
      snap.stats[LONG_TASK_MAX_METRIC] = { count: 1, sum: 100, min: 100, max: 100, mean: 100 };

      expect(checkFrameBudget(snap).pass).toBe(true);
    });

    it('honors custom thresholds', () => {
      const snap = snapshot();
      snap.counters[FRAME_DROPPED_METRIC] = 3;
      snap.stats[LONG_TASK_MAX_METRIC] = { count: 1, sum: 90, min: 90, max: 90, mean: 90 };

      expect(checkFrameBudget(snap, { maxDroppedFrames: 3, maxLongTaskMs: 90 }).pass).toBe(true);
      expect(checkFrameBudget(snap, { maxDroppedFrames: 2 }).pass).toBe(false);
      expect(checkFrameBudget(snap, { maxLongTaskMs: 89 }).pass).toBe(false);
    });

    it('reads counters/stats recorded by startFrameTracking end to end', () => {
      const session = startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0); // baseline
      raf.tick(136); // delta 136 => 8 dropped AND a 136ms long task
      stopFrameTracking(session);

      expect(checkFrameBudget(snapshot())).toEqual({
        pass: false,
        droppedFrames: 8,
        longTaskCount: 1,
        longTaskMaxMs: 136,
      });
    });

    it('evaluates a session summary per session: earlier sessions do not poison later budgets', () => {
      // Session A drops frames and hits a long task.
      const a = startFrameTracking({ expectedFrameMs: 16 });
      raf.tick(0); // baseline
      raf.tick(80); // 4 dropped + 80ms long task
      const summaryA = stopFrameTracking(a);
      expect(summaryA).toEqual({ droppedFrames: 4, longTaskCount: 1, longTaskMaxMs: 80 });
      expect(checkFrameBudget(summaryA!).pass).toBe(false);

      // Session B runs clean, without any metrics.reset() between sessions:
      // the global snapshot is poisoned by session A, but the session summary
      // is isolated.
      const b = startFrameTracking({ expectedFrameMs: 16 });
      raf.tick(0); // baseline
      raf.tick(1); // fast frame
      const summaryB = stopFrameTracking(b);
      expect(summaryB).toEqual({ droppedFrames: 0, longTaskCount: 0, longTaskMaxMs: 0 });
      expect(checkFrameBudget(summaryB!).pass).toBe(true);

      // The global snapshot still shows session A's totals (cumulative buffer).
      expect(checkFrameBudget(snapshot()).droppedFrames).toBe(4);
      expect(checkFrameBudget(snapshot()).pass).toBe(false);
    });
  });

  describe('session bookkeeping', () => {
    it('starting a second session stops the previous one', () => {
      const first = startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0, 16); // session 1 frame: duration 16ms, delta none
      expect(raf.pending()).toBe(1);

      const second = startFrameTracking({ expectedFrameMs: 16 });

      // Session 1 was stopped: its pending frame is cancelled and replaced.
      expect(first.summary()).toEqual({ droppedFrames: 0, longTaskCount: 0, longTaskMaxMs: 0 });
      expect(raf.pending()).toBe(1);

      raf.tick(50, 60); // session 2 frame 1: delta none, duration 10ms
      stopFrameTracking(second);

      const snap: MetricsSnapshot = snapshot();
      expect(snap.counters[FRAME_DROPPED_METRIC]).toBeUndefined();
      expect(snap.counters[LONG_TASK_COUNT_METRIC]).toBeUndefined();
    });

    it('summary() after stop stays at the final tallies', () => {
      const session = startFrameTracking({ expectedFrameMs: 16 });

      raf.tick(0, 0); // baseline
      raf.tick(48, 48); // delta 48 => 2 dropped, duration 0

      const before = session.summary();
      stopFrameTracking(session);
      const after: FrameTrackingSummary = session.summary();

      expect(after).toBe(before);
      expect(after.droppedFrames).toBe(2);
    });

    it('stopFrameTracking returns null when no session is active', () => {
      expect(stopFrameTracking()).toBeNull();
    });
  });
});

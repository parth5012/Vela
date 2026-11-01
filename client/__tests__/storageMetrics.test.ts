/**
 * Tests for storage query metrics (WF-499-06 / #505).
 *
 * Test discipline: performance.now() is mocked and driven with scripted
 * values; all assertions are on counts, values, and events. No wall-clock
 * assertions.
 *
 * Clock consumption per instrumented query with a mocked performance.now:
 * production reads it exactly twice — once at query start, once at stop —
 * so the delta (start, end) is the recorded storage.query.duration sample.
 */
jest.mock('../db/client', () => {
  const mockSelect = jest.fn();
  const mockInsert = jest.fn();
  const mockDelete = jest.fn();
  const mockUpdate = jest.fn();
  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
    },
    initializeDatabase: jest.fn(async () => {}),
    expoDb: {},
    default: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-file-system', () => {
  const state = { documentDirectory: null as string | null, exists: false, size: 0 };
  return {
    __setFsState(next: Partial<typeof state>) {
      Object.assign(state, next);
    },
    documentDirectory: state.documentDirectory,
    getInfoAsync: () => Promise.resolve({ exists: state.exists, size: state.size }),
  };
});

import { reset, snapshot, record, METRICS_STORAGE_KEY, MAX_METRIC_SAMPLES } from '../utils/metrics';
import * as FileSystem from 'expo-file-system';
import {
  STORAGE_QUERY_COUNT_METRIC,
  STORAGE_QUERY_DURATION_METRIC,
  STORAGE_DB_SIZE_METRIC,
  HISTORY_MAX_QUERIES,
  HISTORY_MAX_DURATION_MS,
  THREAD_LIST_MAX_QUERIES,
  instrumentQuery,
  checkStorageBudget,
  checkStorageWindow,
  resolveStorageWindow,
  recordDatabaseSizeMib,
} from '../utils/storageMetrics';

interface PerfHarness {
  /* Sets the scripted performance.now() values, consumed in order. */
  set(values: number[]): void;
  restore(): void;
}

function installClockHarness(): PerfHarness {
  let clock: number[] = [];
  const spy = jest
    .spyOn(globalThis.performance, 'now')
    .mockImplementation(() => clock.shift() ?? 0);
  return {
    set(values: number[]) {
      clock = [...values];
    },
    restore() {
      spy.mockRestore();
    },
  };
}

beforeEach(() => {
  reset();
});

describe('storage metrics constants', () => {
  it('exposes the ticket metric names', () => {
    expect(STORAGE_QUERY_COUNT_METRIC).toBe('storage.query.count');
    expect(STORAGE_QUERY_DURATION_METRIC).toBe('storage.query.duration');
  });

  it('exposes budget constants documented in the ticket', () => {
    expect(HISTORY_MAX_QUERIES).toBe(1);
    expect(HISTORY_MAX_DURATION_MS).toBe(100);
    expect(THREAD_LIST_MAX_QUERIES).toBe(2);
  });
});

describe('instrumentQuery (wrapped db query helper)', () => {
  let harness: PerfHarness;

  beforeEach(() => {
    harness = installClockHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it('runs the wrapped query unchanged and increments the query count', async () => {
    harness.set([10, 12]);

    const run = jest.fn(async () => 'result-value');
    const result = await instrumentQuery('test.query', run);

    expect(result).toBe('result-value');
    expect(run).toHaveBeenCalledTimes(1);
    expect(snapshot().counters[STORAGE_QUERY_COUNT_METRIC]).toBe(1);
  });

  it('records the query duration once with the scripted delta', async () => {
    harness.set([100, 140]);

    await instrumentQuery('test.query', async () => 'ok');

    const stats = snapshot().stats[STORAGE_QUERY_DURATION_METRIC];
    expect(stats).toMatchObject({ count: 1, sum: 40, min: 40, max: 40 });
  });

  it('accumulates count and one duration sample per query', async () => {
    harness.set([0, 5, 1000, 1015, 2000, 2015]);

    await instrumentQuery('test.a', async () => 1);
    await instrumentQuery('test.b', async () => 2);
    await instrumentQuery('test.a', async () => 3);

    const snap = snapshot();
    expect(snap.counters[STORAGE_QUERY_COUNT_METRIC]).toBe(3);
    expect(snap.stats[STORAGE_QUERY_DURATION_METRIC]).toMatchObject({
      count: 3,
      sum: 35,
      min: 5,
      max: 15,
    });
  });

  it('still counts and records when the query rejects, then rethrows unchanged', async () => {
    harness.set([500, 525]);
    const failure = new Error('boom');

    await expect(
      instrumentQuery('test.query', async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    const snap = snapshot();
    expect(snap.counters[STORAGE_QUERY_COUNT_METRIC]).toBe(1);
    expect(snap.stats[STORAGE_QUERY_DURATION_METRIC]).toMatchObject({ count: 1, max: 25 });
  });

  it('passes arguments/returns through exactly one time (single call, same rows)', async () => {
    harness.set([0, 1]);
    const rows = [{ id: 't1' }, { id: 't2' }];

    const result = await instrumentQuery('test.rows', async () => rows);

    expect(result).toBe(rows);
  });
});

describe('checkStorageBudget (pure budget check)', () => {
  it('passes a history window with 1 query at 100ms exactly', () => {
    expect(
      checkStorageBudget({ queryCount: 1, durationMaxMs: 100 }, 'history')
    ).toMatchObject({ pass: true, queryCount: 1, maxQueries: 1 });
  });

  it('fails history on more than 1 query', () => {
    const result = checkStorageBudget({ queryCount: 2, durationMaxMs: 5 }, 'history');
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBe(1);
  });

  it('fails history on duration above 100ms even with a single query', () => {
    const result = checkStorageBudget({ queryCount: 1, durationMaxMs: 101 }, 'history');
    expect(result.pass).toBe(false);
    expect(result.violations.join(' ')).toContain('duration');
  });

  it('evaluates the thread list on query count only (max 2)', () => {
    expect(checkStorageBudget({ queryCount: 2 }, 'threadList').pass).toBe(true);
    expect(checkStorageBudget({ queryCount: 3 }, 'threadList').pass).toBe(false);
    expect(
      checkStorageBudget({ queryCount: 2, durationMaxMs: 10000 }, 'threadList').pass
    ).toBe(true);
  });

  it('reads a MetricsSnapshot (cumulative counters + duration stats)', () => {
    const snap = snapshot();
    expect(checkStorageBudget(snap, 'history')).toMatchObject({
      pass: true,
      queryCount: 0,
    });

    const withWindow = checkStorageBudget(
      {
        samples: [],
        counters: { [STORAGE_QUERY_COUNT_METRIC]: 1 },
        stats: { [STORAGE_QUERY_DURATION_METRIC]: { count: 1, sum: 50, min: 50, max: 50, mean: 50 } },
      },
      'history'
    );
    expect(withWindow.pass).toBe(true);
  });

  it('allows thresholds to override the per-screen defaults', () => {
    expect(
      checkStorageBudget({ queryCount: 4 }, 'threadList', { maxQueries: 4 }).pass
    ).toBe(true);
    expect(
      checkStorageBudget({ queryCount: 4, durationMaxMs: 20 }, 'history', {
        maxQueries: 4,
        maxDurationMs: 50,
      }).pass
    ).toBe(true);
  });
});

describe('resolveStorageWindow / checkStorageWindow (per-transition window)', () => {
  let harness: PerfHarness;

  beforeEach(() => {
    harness = installClockHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it('returns the query/duration delta between two snapshots', async () => {
    harness.set([0, 10, 100, 115, 200, 220]);
    await instrumentQuery('test.before', async () => 'pre');
    const before = snapshot();

    await instrumentQuery('test.w1', async () => 'a');
    await instrumentQuery('test.w2', async () => 'b');
    const after = snapshot();

    expect(resolveStorageWindow(before, after)).toMatchObject({
      queryCount: 2,
      durationSamples: [15, 20],
      durationMaxMs: 20,
    });
  });

  it('resolves an empty window (no queries after the baseline snapshot)', async () => {
    harness.set([0, 1]);
    await instrumentQuery('test.pre', async () => 'pre');
    const before = snapshot();
    const after = snapshot();

    expect(resolveStorageWindow(before, after)).toMatchObject({
      queryCount: 0,
      durationSamples: [],
      durationMaxMs: 0,
    });
  });

  it('checkStorageWindow applies screen budgets to the resolved window', async () => {
    harness.set([0, 10, 100, 120]);
    await instrumentQuery('test.pre', async () => 'pre');
    const before = snapshot();
    await instrumentQuery('test.w', async () => 'x');
    await instrumentQuery('test.w2', async () => 'y');
    const after = snapshot();

    // 2 queries inside a transition window exceed the history budget (max 1).
    expect(checkStorageWindow(before, after, 'history').pass).toBe(false);

    // Same window stays within the thread-list budget (max 2).
    expect(checkStorageWindow(before, after, 'threadList').pass).toBe(true);
  });

  it('checkStorageWindow fails history on slow window queries', async () => {
    harness.set([0, 10, 100, 300]);
    await instrumentQuery('test.f1', async () => 'a');
    await instrumentQuery('test.f2', async () => 'b');
    const before = snapshot();
    const after = snapshot();
    // Empty window passes regardless.
    expect(checkStorageWindow(before, after, 'history').pass).toBe(true);
  });
});

describe('recordDatabaseSizeMib (DB size helper)', () => {
  const fsMock = FileSystem as unknown as {
    __setFsState(next: { documentDirectory?: string | null; exists?: boolean; size?: number }): void;
  };

  afterEach(() => {
    fsMock.__setFsState({ documentDirectory: null, exists: false, size: 0 });
  });

  it('records the file size as storage.db.size.mib', async () => {
    fsMock.__setFsState({ documentDirectory: 'file:///docs/', exists: true, size: 4 * 1024 * 1024 });

    const size = await recordDatabaseSizeMib();

    const sample = snapshot().samples.find((s) => s.name === STORAGE_DB_SIZE_METRIC);
    expect(size).toBe(4);
    expect(sample).toMatchObject({ kind: 'histogram', value: 4 });
  });

  it('returns null without recording when the db file is absent', async () => {
    const size = await recordDatabaseSizeMib();

    expect(size).toBeNull();
    expect(snapshot().samples.some((s) => s.name === STORAGE_DB_SIZE_METRIC)).toBe(false);
  });
});

describe('metrics module contract (light build sanity)', () => {
  it('persists through the existing metrics storage contract', () => {
    expect(METRICS_STORAGE_KEY).toBe('vela_metrics_v1');
    expect(MAX_METRIC_SAMPLES).toBe(1000);
  });
});

describe('storage window resolution under bounded-buffer wrap (regression)', () => {
  let nowSpy: jest.SpyInstance<number, []>;
  let nextReads: number[] = [];

  afterEach(() => {
    nowSpy?.mockRestore();
  });

  function instrumentedQueryFor(duration: number): Promise<void> {
    // instrumentQuery reads performance.now() twice: start then stop — the
    // delta is the recorded duration sample.
    nextReads = [0, duration];
    return instrumentQuery('test.wrap', async () => {});
  }

  it('resolves the window via sample sequences when the buffer is at its cap', async () => {
    nowSpy = jest.spyOn(globalThis.performance, 'now').mockImplementation(() => nextReads.shift() ?? 0);

    // Fill the buffer to its cap with unrelated samples.
    for (let i = 0; i < MAX_METRIC_SAMPLES; i++) {
      record('unrelated.fill', i);
    }
    expect(snapshot().samples.length).toBe(MAX_METRIC_SAMPLES);

    const before = snapshot();
    expect(before.samples.length).toBe(MAX_METRIC_SAMPLES);

    // One 300ms query inside the window — above the 100ms history budget.
    await instrumentedQueryFor(300);
    const after = snapshot(); // still at the cap: one old unrelated sample was evicted

    const win = resolveStorageWindow(before, after);
    // Index-slicing (the regression) would produce an empty window and pass.
    expect(win.queryCount).toBe(1);
    expect(win.durationSamples).toEqual([300]);
    expect(win.durationMaxMs).toBe(300);
    expect(checkStorageWindow(before, after, 'history').pass).toBe(false);
  });

  it('keeps the per-window query count accurate when baseline counter samples are evicted', async () => {
    nowSpy = jest.spyOn(globalThis.performance, 'now').mockImplementation(() => nextReads.shift() ?? 0);

    // 50 baseline queries, then fill the rest of the unrelated buffer so the
    // baseline counter contributions are evicted from the retained samples.
    for (let i = 0; i < 50; i++) {
      await instrumentedQueryFor(1);
    }
    for (let i = 0; i < Math.max(0, MAX_METRIC_SAMPLES - 100); i++) {
      record('unrelated.fill', i);
    }
    const before = snapshot();

    // Within the window: queries whose plain counter-diff would clamp to 0.
    for (let i = 0; i < 3; i++) {
      await instrumentedQueryFor(1);
    }
    const after = snapshot();

    const win = resolveStorageWindow(before, after);
    expect(win.queryCount).toBe(3);
    expect(win.durationSamples).toEqual([1, 1, 1]);
  });
});

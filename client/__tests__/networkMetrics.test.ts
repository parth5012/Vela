jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { reset, snapshot } from '../utils/metrics';
import {
  classifyEndpoint,
  instrumentFetch,
  flushDailySummary,
  countMetricName,
  durationMetricName,
  errorsMetricName,
} from '../utils/networkMetrics';

interface PerfHarness {
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

describe('classifyEndpoint', () => {
  it('classifies known endpoints', () => {
    expect(classifyEndpoint('https://api.example.com/health')).toBe('health');
    expect(classifyEndpoint('https://api.example.com/threads')).toBe('threads');
    expect(classifyEndpoint('https://api.example.com/api/messages')).toBe('messages');
    expect(classifyEndpoint('https://api.example.com/tasks/run')).toBe('tasks');
    expect(classifyEndpoint('https://api.example.com/api/sync/push')).toBe('sync');
  });

  it('returns other for unknown', () => {
    expect(classifyEndpoint('https://api.example.com/foo/bar')).toBe('other');
  });

  it('handles Request/URL objects', () => {
    expect(classifyEndpoint(new URL('https://x/threads'))).toBe('threads');
    expect(classifyEndpoint(new Request('https://x/sync/pull'))).toBe('sync');
  });

  it('is case-insensitive', () => {
    expect(classifyEndpoint('https://x/HEALTH')).toBe('health');
  });
});

describe('instrumentFetch', () => {
  let harness: PerfHarness;

  beforeEach(() => {
    harness = installClockHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it('records count + duration on success, no error', async () => {
    harness.set([10, 25]);
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }));
    const f = instrumentFetch(fetchImpl as any);

    const res = await f('https://api.example.com/health');

    expect(res).toMatchObject({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const snap = snapshot();
    expect(snap.counters[countMetricName('health')]).toBe(1);
    expect(snap.stats[durationMetricName('health')]).toMatchObject({ count: 1, sum: 15 });
    expect(snap.counters[errorsMetricName('health')]).toBeUndefined();
  });

  it('records error + count + duration on throw and rethrows', async () => {
    harness.set([5, 30]);
    const failure = new Error('boom');
    const fetchImpl = jest.fn(async () => {
      throw failure;
    });
    const f = instrumentFetch(fetchImpl as any);

    await expect(f('https://api.example.com/threads')).rejects.toBe(failure);

    const snap = snapshot();
    expect(snap.counters[countMetricName('threads')]).toBe(1);
    expect(snap.stats[durationMetricName('threads')]).toMatchObject({ count: 1 });
    expect(snap.counters[errorsMetricName('threads')]).toBe(1);
  });

  it('records error on non-2xx status', async () => {
    harness.set([0, 10]);
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 500 }));
    const f = instrumentFetch(fetchImpl as any);

    const res = await f('https://api.example.com/sync/push');

    expect(res).toMatchObject({ status: 500 });
    const snap = snapshot();
    expect(snap.counters[countMetricName('sync')]).toBe(1);
    expect(snap.stats[durationMetricName('sync')]).toMatchObject({ count: 1 });
    expect(snap.counters[errorsMetricName('sync')]).toBe(1);
  });

  it('classifies endpoint from URL', async () => {
    harness.set([0, 1, 0, 1]);
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }));
    const f = instrumentFetch(fetchImpl as any);
    await f('https://x/api/tasks/run');
    await f('https://x/messages');
    const snap = snapshot();
    expect(snap.counters[countMetricName('tasks')]).toBe(1);
    expect(snap.counters[countMetricName('messages')]).toBe(1);
  });
});

describe('flushDailySummary', () => {
  it('aggregates and returns summary', () => {
    const summary = flushDailySummary();
    expect(summary.totalRequests).toBe(0);
    expect(summary.endpoints).toBeDefined();
  });
});

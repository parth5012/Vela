/**
 * Tests for the client-side metrics module (utils/metrics.ts).
 *
 * Test discipline: no Date.now()/performance.now() wall-clock deltas.
 * Timer behavior uses a scripted fake clock, and all assertions are on
 * counts, sample contents, and persisted bytes/events.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  METRICS_STORAGE_KEY,
  counter,
  flush,
  histogram,
  load,
  record,
  reset,
  snapshot,
  timer,
  type MetricsSnapshot,
} from '../utils/metrics';

describe('metrics', () => {
  beforeEach(() => {
    reset();
  });

  describe('counters', () => {
    it('increments by 1 by default and accumulates the total', () => {
      const c = counter('messages_sent');
      c.inc();
      c.inc();

      expect(snapshot().counters['messages_sent']).toBe(2);
    });

    it('increments by an explicit amount', () => {
      counter('tokens_used').inc(5);

      expect(snapshot().counters['tokens_used']).toBe(5);
    });

    it('records one sample per increment event', () => {
      const c = counter('messages_sent');
      c.inc();
      c.inc(3);

      const events = snapshot().samples.filter((s) => s.name === 'messages_sent');
      expect(events).toHaveLength(2);
      expect(events.every((s) => s.kind === 'counter')).toBe(true);
      expect(events.map((s) => s.value)).toEqual([1, 3]);
    });
  });

  describe('record', () => {
    it('records a histogram sample directly', () => {
      record('tok_per_sec', 42.5);

      const events = snapshot().samples;
      expect(events).toHaveLength(1);
      expect(events[0]?.name).toBe('tok_per_sec');
      expect(events[0]?.value).toBe(42.5);
      expect(events[0]?.kind).toBe('histogram');
    });
  });

  describe('timer', () => {
    it('start/stop records exactly one timer sample of the scripted duration', () => {
      // Scripted fake clock: deterministic, asserts no real wallClock deltas.
      let fakeTime = 1000;
      const clockSpy = jest
        .spyOn(globalThis.performance, 'now')
        .mockImplementation(() => fakeTime);

      const t = timer('first_token_ms');
      t.start();
      fakeTime = 1005;
      const duration = t.stop();

      expect(duration).toBe(5);

      const events = snapshot().samples.filter((s) => s.name === 'first_token_ms');
      expect(events).toHaveLength(1);
      expect(events[0]?.value).toBe(5);
      expect(events[0]?.kind).toBe('timer');

      clockSpy.mockRestore();
    });

    it('stop without start records nothing and returns null', () => {
      const duration = timer('never_started').stop();

      expect(duration).toBeNull();
      expect(snapshot().samples).toHaveLength(0);
    });

    it('stop expires the start mark so each interval is measured once', () => {
      let fakeTime = 0;
      const clockSpy = jest
        .spyOn(globalThis.performance, 'now')
        .mockImplementation(() => fakeTime);

      const t = timer('interval_ms');
      t.start();
      fakeTime = 10;
      t.stop();
      // Without a new start() there is no pending interval left.
      expect(t.stop()).toBeNull();

      const events = snapshot().samples.filter((s) => s.name === 'interval_ms');
      expect(events).toHaveLength(1);
      expect(events[0]?.value).toBe(10);

      clockSpy.mockRestore();
    });
  });

  describe('histogram', () => {
    it('captures observed values with summarized stats', () => {
      const h = histogram('latency_ms');
      h.observe(10);
      h.observe(20);
      h.observe(30);

      const snap: MetricsSnapshot = snapshot();
      const stats = snap.stats['latency_ms'];
      expect(stats).toEqual({
        count: 3,
        sum: 60,
        min: 10,
        max: 30,
        mean: 20,
      });
      expect(snap.counters['latency_ms']).toBeUndefined();
    });

    it('ignores non-finite values', () => {
      histogram('latency_ms').observe(Number.NaN);

      expect(snapshot().samples).toHaveLength(0);
    });
  });

  describe('bounded ring buffer', () => {
    it('evicts the oldest samples beyond the 1,000-sample cap', () => {
      record('oldest', 1);
      for (let i = 0; i < 1005; i++) {
        record('bulk', i);
      }

      const snap = snapshot();
      expect(snap.samples).toHaveLength(1000);
      // The oldest sample ('oldest') was evicted by the newer bulk samples.
      expect(snap.samples.some((s) => s.name === 'oldest')).toBe(false);
      // The very first retained sample is the earliest bulk sample.
      expect(snap.samples[0]?.name).toBe('bulk');
    });

    it('keeps the most recent samples in eviction order', () => {
      for (let i = 0; i < 1002; i++) {
        record('seq', i);
      }

      const seq = snapshot().samples.map((s) => s.value);
      expect(seq[0]).toBe(2); // samples 0 and 1 evicted, 1002 recorded total
      expect(seq[seq.length - 1]).toBe(1001);
    });

    it('counts on stats reflect only retained samples after eviction', () => {
      for (let i = 0; i < 1005; i++) {
        record('bulk', i);
      }

      const stats = snapshot().stats['bulk'];
      expect(stats?.count).toBe(1000);
    });
  });

  describe('persistence', () => {
    it('flush() writes the buffer to AsyncStorage under vela_metrics_v1', async () => {
      counter('flush_counter').inc(2);
      histogram('flush_hist').observe(7);

      await flush();

      const raw = await AsyncStorage.getItem(METRICS_STORAGE_KEY);
      expect(raw).not.toBeNull();
      if (raw === null) return;
      const persisted = JSON.parse(raw) as { samples: Array<{ name: string }> };
      const names = persisted.samples.map((s) => s.name);
      expect(names).toContain('flush_counter');
      expect(names).toContain('flush_hist');
    });

    it('round-trips through flush() -> reset() -> load()', async () => {
      counter('roundtrip_counter').inc(3);
      histogram('roundtrip_hist').observe(11);
      await flush();

      reset();
      expect(snapshot().samples).toHaveLength(0);

      await load();

      const snap = snapshot();
      expect(snap.counters['roundtrip_counter']).toBe(3);
      expect(snap.stats['roundtrip_hist']?.count).toBe(1);
      expect(snap.samples.filter((s) => s.name === 'roundtrip_counter')).toHaveLength(1);
      expect(snap.samples.filter((s) => s.name === 'roundtrip_hist')).toHaveLength(1);
    });

    it('load() keeps existing in-memory samples and appends persisted ones', async () => {
      counter('mixed').inc();
      await flush();
      reset();

      counter('in_memory_only').inc();
      await load();

      const snap = snapshot();
      expect(snap.counters['mixed']).toBe(1);
      expect(snap.counters['in_memory_only']).toBe(1);
      expect(snap.samples).toHaveLength(2);
    });

    it('load() tolerates missing or malformed persisted data', async () => {
      await AsyncStorage.removeItem(METRICS_STORAGE_KEY);
      await load();
      expect(snapshot().samples).toHaveLength(0);

      await AsyncStorage.setItem(METRICS_STORAGE_KEY, 'not-json');
      await load();
      expect(snapshot().samples).toHaveLength(0);
    });
  });
});

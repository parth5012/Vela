import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { perfTracker, useRenderCount } from '../utils/perfTracker';

describe('perfTracker - Zero-Allocation Telemetry & Ring Buffer', () => {
  beforeEach(() => {
    perfTracker.reset();
  });

  describe('mark and measure', () => {
    it('records marks and measures elapsed time', () => {
      const t0 = perfTracker.mark('start');
      expect(typeof t0).toBe('number');

      // Busy wait a tiny amount or simulate time
      const t1 = perfTracker.mark('end');
      expect(t1).toBeGreaterThanOrEqual(t0);

      const duration = perfTracker.measure('task', 'start', 'end');
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBe(t1 - t0);
    });

    it('measures from startMark to now when endMark is omitted', () => {
      perfTracker.mark('begin');
      const duration = perfTracker.measure('ongoing', 'begin');
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('returns -1 or handles unknown startMark gracefully', () => {
      const duration = perfTracker.measure('invalid', 'nonexistent');
      expect(duration).toBe(-1);
    });
  });

  describe('recordMetric and percentile calculations', () => {
    it('records raw metrics and computes p50, p95, p99, mean', () => {
      // Record 100 values: 1 to 100
      for (let i = 1; i <= 100; i++) {
        perfTracker.recordMetric('latency', i, 'ms');
      }

      const summary = perfTracker.flush();
      expect(summary.latency).toBeDefined();
      expect(summary.latency.count).toBe(100);
      expect(summary.latency.unit).toBe('ms');
      expect(summary.latency.mean).toBeCloseTo(50.5, 1);
      expect(summary.latency.min).toBe(1);
      expect(summary.latency.max).toBe(100);
      // p50 should be around 50
      expect(summary.latency.p50).toBe(50);
      // p95 should be around 95
      expect(summary.latency.p95).toBe(95);
      // p99 should be around 99
      expect(summary.latency.p99).toBe(99);
    });

    it('handles small sample sizes accurately', () => {
      perfTracker.recordMetric('parse_time', 10);
      perfTracker.recordMetric('parse_time', 20);
      perfTracker.recordMetric('parse_time', 30);

      const summary = perfTracker.flush();
      expect(summary.parse_time.count).toBe(3);
      expect(summary.parse_time.p50).toBe(20);
      expect(summary.parse_time.mean).toBe(20);
      expect(summary.parse_time.min).toBe(10);
      expect(summary.parse_time.max).toBe(30);
    });
  });

  describe('ring buffer wrapping', () => {
    it('handles more entries than the buffer size (1024) without crashing or allocating unbounded objects', () => {
      // Push 2500 marks through the 1024 buffer
      for (let i = 0; i < 2500; i++) {
        perfTracker.mark(`mark_${i % 10}`);
      }
      // Should not throw and latest marks should still be resolvable
      const duration = perfTracker.measure('diff', 'mark_0', 'mark_1');
      expect(typeof duration).toBe('number');
    });
  });

  describe('flushToLogcat', () => {
    it('emits a single compact JSON line to console.log', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      perfTracker.recordMetric('test_metric', 42);
      perfTracker.flushToLogcat('VelaPerf');

      expect(spy).toHaveBeenCalledTimes(1);
      const logOutput = spy.mock.calls[0][0];
      expect(logOutput).toContain('[VelaPerf]');
      expect(logOutput).toContain('"test_metric"');
      expect(logOutput).toContain('42');
      spy.mockRestore();
    });
  });

  describe('useRenderCount', () => {
    it('tracks component render commits accurately', () => {
      let currentRenders = 0;
      const TestComponent = ({ value }: { value: number }) => {
        currentRenders = useRenderCount('ChatCell');
        return React.createElement('View', null, String(value));
      };

      let component: renderer.ReactTestRenderer;
      act(() => {
        component = renderer.create(React.createElement(TestComponent, { value: 1 }));
      });
      expect(currentRenders).toBe(1);

      act(() => {
        component.update(React.createElement(TestComponent, { value: 2 }));
      });
      expect(currentRenders).toBe(2);

      act(() => {
        component.update(React.createElement(TestComponent, { value: 3 }));
      });
      expect(currentRenders).toBe(3);

      const summary = perfTracker.flush();
      expect(summary.ChatCell_renders.max).toBe(3);
    });
  });

  describe('memory telemetry (WF-427-05)', () => {
    it('tracks heap memory and computes session memory growth delta', () => {
      const initialHeap = perfTracker.trackMemory('initial_heap');
      expect(typeof initialHeap).toBe('number');
      expect(initialHeap).toBeGreaterThanOrEqual(0);

      // Allocate array to simulate turn state growth
      const dummyTurns: string[] = [];
      for (let i = 0; i < 5000; i++) {
        dummyTurns.push(`turn payload message content ${i}`);
      }

      const growth = perfTracker.measureMemoryGrowth(initialHeap);
      expect(typeof growth).toBe('number');
      expect(growth).toBeGreaterThanOrEqual(0);

      const summary = perfTracker.flush();
      expect(summary.initial_heap).toBeDefined();
      expect(summary.session_memory_growth_mb).toBeDefined();
    });
  });
});

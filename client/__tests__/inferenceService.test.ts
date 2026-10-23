import {
  InferenceForegroundService,
  DEFAULT_SAMPLING_DEFAULTS,
  type InferenceRequest,
  type InferenceServiceConfig,
  type InferenceTelemetry,
} from '../utils/inferenceService';

describe('WF-06: Inference Foreground Service + Internal Bridge', () => {
  let mockDriver: {
    init: jest.Mock;
    generate: jest.Mock;
    unload: jest.Mock;
    getMemoryUsageMb: jest.Mock;
  };

  let mockNotifications: {
    presentNotification: jest.Mock;
    cancelNotification: jest.Mock;
  };

  beforeEach(() => {
    mockDriver = {
      init: jest.fn().mockResolvedValue(true),
      generate: jest.fn().mockImplementation(async (prompt, sampling, onToken, signal) => {
        onToken('Hello');
        onToken(' from');
        onToken(' MiniCPM5-2B');
        return { text: 'Hello from MiniCPM5-2B', tokenCount: 3 };
      }),
      unload: jest.fn().mockResolvedValue(undefined),
      getMemoryUsageMb: jest.fn().mockResolvedValue(1750),
    };

    mockNotifications = {
      presentNotification: jest.fn().mockResolvedValue(undefined),
      cancelNotification: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('Model Card Sampling Defaults', () => {
    it('enforces MiniCPM5-2B model card defaults (temp=1.0, top_p=0.95, min_p=0.0)', () => {
      expect(DEFAULT_SAMPLING_DEFAULTS.temperature).toBe(1.0);
      expect(DEFAULT_SAMPLING_DEFAULTS.top_p).toBe(0.95);
      expect(DEFAULT_SAMPLING_DEFAULTS.min_p).toBe(0.0);
    });
  });

  describe('Lifecycle Management (Lazy Load, Idle Unload, Persistent Notification)', () => {
    it('lazy loads model on first request and maintains persistent notification', async () => {
      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
        modelPath: '/data/models/MiniCPM5-2B_int4.litertlm',
      });

      expect(service.isLoaded()).toBe(false);
      expect(mockDriver.init).not.toHaveBeenCalled();

      const tokens: string[] = [];
      const result = await service.infer({
        requestId: 'req-1',
        prompt: 'Hi',
        onToken: (tok) => tokens.push(tok),
      });

      expect(service.isLoaded()).toBe(true);
      expect(mockDriver.init).toHaveBeenCalledWith('/data/models/MiniCPM5-2B_int4.litertlm');
      expect(mockNotifications.presentNotification).toHaveBeenCalled();
      expect(result.text).toBe('Hello from MiniCPM5-2B');
      expect(tokens).toEqual(['Hello', ' from', ' MiniCPM5-2B']);
    });

    afterEach(async () => {
      jest.useRealTimers();
    });

    it('triggers idle unload after configured idle timeout', async () => {
      jest.useFakeTimers();

      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
        modelPath: '/data/models/MiniCPM5-2B_int4.litertlm',
        idleTimeoutMs: 1000,
      });

      await service.infer({
        requestId: 'req-1',
        prompt: 'Hi',
        onToken: () => {},
      });

      expect(service.isLoaded()).toBe(true);
      expect(mockDriver.unload).not.toHaveBeenCalled();

      // Advance timers past idle timeout
      jest.advanceTimersByTime(1100);
      await Promise.resolve();

      expect(mockDriver.unload).toHaveBeenCalled();
      expect(service.isLoaded()).toBe(false);
      expect(mockNotifications.cancelNotification).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('explicit stop unloads model and cancels notification immediately', async () => {
      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
        modelPath: '/data/models/MiniCPM5-2B_int4.litertlm',
      });

      await service.infer({
        requestId: 'req-1',
        prompt: 'Hi',
        onToken: () => {},
      });

      expect(service.isLoaded()).toBe(true);
      await service.stop();

      expect(service.isLoaded()).toBe(false);
      expect(mockDriver.unload).toHaveBeenCalled();
      expect(mockNotifications.cancelNotification).toHaveBeenCalled();
    });
  });

  describe('Internal Request Interface & Streaming with Cancellation', () => {
    it('supports cancellation mid-generation via AbortController signal', async () => {
      const abortController = new AbortController();

      mockDriver.generate.mockImplementation(async (prompt, sampling, onToken, signal) => {
        onToken('First');
        abortController.abort();
        if (signal?.aborted) {
          const err = new Error('Inference aborted by caller');
          err.name = 'AbortError';
          throw err;
        }
        onToken('Second');
        return { text: 'First Second', tokenCount: 2 };
      });

      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
      });

      const tokens: string[] = [];
      await expect(
        service.infer({
          requestId: 'req-cancel',
          prompt: 'Generate',
          onToken: (tok) => tokens.push(tok),
          signal: abortController.signal,
        })
      ).rejects.toThrow('Inference aborted');

      expect(tokens).toEqual(['First']);
    });
  });

  describe('Memory and Thermal Throttling Hooks', () => {
    it('prunes context window under moderate memory warnings', async () => {
      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
        initialContextWindow: 4096,
      });

      expect(service.getContextWindowLimit()).toBe(4096);

      service.handleMemoryPressure('MODERATE');

      expect(service.getContextWindowLimit()).toBe(1024);
      expect(service.isThrottled()).toBe(true);
    });

    it('halts inference and unloads immediately under CRITICAL memory pressure', async () => {
      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
      });

      await service.infer({
        requestId: 'req-mem',
        prompt: 'Hello',
        onToken: () => {},
      });

      expect(service.isLoaded()).toBe(true);

      const fallbackTriggered = jest.fn();
      service.onCloudFallbackRequired(fallbackTriggered);

      await service.handleMemoryPressure('CRITICAL');

      expect(service.isLoaded()).toBe(false);
      expect(mockDriver.unload).toHaveBeenCalled();
      expect(fallbackTriggered).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'TRIM_MEMORY_RUNNING_CRITICAL' })
      );
    });

    it('aborts inference and unloads under critical thermal throttling', async () => {
      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
      });

      await service.infer({
        requestId: 'req-therm',
        prompt: 'Hello',
        onToken: () => {},
      });

      await service.handleThermalStatus('critical');

      expect(service.isLoaded()).toBe(false);
      expect(mockDriver.unload).toHaveBeenCalled();
    });
  });

  describe('End-to-End Offline Chat Smoke Test', () => {
    it('runs offline chat turn end-to-end with token metrics', async () => {
      const service = new InferenceForegroundService({
        driver: mockDriver,
        notifications: mockNotifications,
      });

      const streamed: string[] = [];
      let completionResult: any = null;

      const telemetry: InferenceTelemetry = await service.infer({
        requestId: 'smoke-offline-1',
        prompt: 'Tell me a joke.',
        onToken: (tok) => streamed.push(tok),
        onComplete: (res) => {
          completionResult = res;
        },
      });

      expect(telemetry.success).toBe(true);
      expect(telemetry.tokensGenerated).toBe(3);
      expect(telemetry.tokensPerSec).toBeGreaterThan(0);
      expect(telemetry.peakRamMb).toBe(1750);
      expect(streamed.join('')).toBe('Hello from MiniCPM5-2B');
      expect(completionResult.text).toBe('Hello from MiniCPM5-2B');
    });
  });
});

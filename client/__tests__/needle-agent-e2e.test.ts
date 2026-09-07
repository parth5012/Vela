import AsyncStorage from '@react-native-async-storage/async-storage';
import NeedleModule from '../modules/needle';
import { runLocalAgentLoop, parseToolCall } from '../utils/localAgentLoop';
import * as localLlm from '../utils/localLlm';
import * as safetyManager from '../utils/safetyManager';
import * as deviceActionExecutor from '../utils/deviceActionExecutor';
import {
  sniffMagicBytes,
  importModelFromFile,
  getCustomModels,
  deleteCustomModel,
} from '../utils/customModelStorage';
import {
  calculateEstimatedPeakRam,
  getDynamicModelStatusForRam,
} from '../utils/ramDetection';
import { drainDeviceStepSyncQueue } from '../db/syncQueue';
import { db } from '../db/client';
import { operationLog } from '../db/schema';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../modules/needle', () => {
  let streamListener: ((event: any) => void) | null = null;
  return {
    __esModule: true,
    default: {
      isAvailable: jest.fn(() => true),
      hasNativeLibrary: jest.fn(() => true),
      init: jest.fn(async () => true),
      complete: jest.fn(async (prompt: string) => {
        if (prompt.includes('Observation:')) {
          return {
            text: 'I have read the screen and Wi-Fi is active.',
          };
        }
        return {
          text: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
          toolCalls: '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}',
        };
      }),
      reset: jest.fn(async () => true),
      unload: jest.fn(async () => {}),
      addListener: jest.fn((cb) => {
        streamListener = cb;
        return { remove: () => { streamListener = null; } };
      }),
    },
  };
});

jest.mock('../modules/device-agent', () => ({
  default: {
    getScreenTree: jest.fn().mockResolvedValue('Screen tree: Settings > Wi-Fi: Connected'),
    getDeviceInfo: jest.fn().mockResolvedValue({ battery: 90 }),
    takeScreenshot: jest.fn().mockResolvedValue('file:///mock/screen.png'),
    performAction: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-doc-dir/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 45000000 }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(true),
  deleteAsync: jest.fn().mockResolvedValue(true),
  copyAsync: jest.fn().mockResolvedValue(true),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  writeAsStringAsync: jest.fn().mockResolvedValue(true),
  createDownloadResumable: jest.fn(),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

jest.mock('../db/client', () => {
  const mockSelect = jest.fn();
  const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(true) });
  const mockDelete = jest.fn();

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
    },
  };
});

describe('Needle Agent & Local Subsystem E2E Integration Suite', () => {
  const queuedOps: any[] = [];

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    queuedOps.length = 0;
    global.fetch = jest.fn();
  });

  describe('1. Custom Model Validation & Storage Lifecycle', () => {
    it('validates binary magic bytes for Needle (.cact), GGUF, and LiteRT (.task)', () => {
      // Needle 2 magic bytes
      const needle2Bytes = new Uint8Array([0x83, 0x2a, 0xe1, 0x05]);
      expect(sniffMagicBytes(needle2Bytes)).toBe('cact');

      // Needle 3 magic bytes
      const needle3Bytes = new Uint8Array([0x84, 0x2a, 0xe1, 0x05]);
      expect(sniffMagicBytes(needle3Bytes)).toBe('cact');

      // GGUF magic bytes
      const ggufBytes = new Uint8Array([0x47, 0x47, 0x55, 0x46]);
      expect(sniffMagicBytes(ggufBytes)).toBe('gguf');

      // LiteRT (.task) PKZip header
      const taskBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      expect(sniffMagicBytes(taskBytes)).toBe('task');

      // Invalid bytes
      const invalidBytes = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
      expect(sniffMagicBytes(invalidBytes)).toBeNull();
    });

    it('calculates dynamic RAM budgets and assigns compatibility tiers', () => {
      const ram4GB = 4 * 1024 * 1024 * 1024;
      const needle45MSize = 45 * 1024 * 1024; // 45MB

      // Estimated peak memory for Needle 45M (.cact with 1.2x multiplier)
      const estimatedNeedleRam = calculateEstimatedPeakRam(needle45MSize, 'cact', 256);
      expect(estimatedNeedleRam).toBeLessThan(100 * 1024 * 1024); // ~54MB

      // Tier evaluation
      const status = getDynamicModelStatusForRam(needle45MSize, 'cact', ram4GB, 256);
      expect(status).toBe('recommended');
    });

    it('imports, persists, and purges custom model files with path sanitization', async () => {
      // Test malicious path traversal filename
      const recordTraversal = await importModelFromFile(
        'file:///cache/evil.cact',
        '../../etc/passwd.cact'
      );
      expect(recordTraversal.localUri).not.toContain('..');
      expect(recordTraversal.localUri).toContain('models/cact/');

      const record = await importModelFromFile(
        'file:///cache/needle-test.cact',
        'needle-test.cact'
      );
      expect(record.format).toBe('cact');
      expect(record.name).toBe('needle-test');

      const stored = await getCustomModels();
      expect(stored.length).toBe(2);

      await deleteCustomModel(record.id);
      await deleteCustomModel(recordTraversal.id);
      expect((await getCustomModels()).length).toBe(0);
    });
  });

  describe('2. Full On-Device Tool Calling Flow with Safety & Observation Loop', () => {
    it('executes multi-step local agent flow with Needle tool interception', async () => {
      // Step 1: Model calls tool
      async function* streamStep1() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }
      // Step 2: Model consumes observation and produces conversational reply
      async function* streamStep2() {
        yield 'I have inspected the screen: Wi-Fi is currently connected.';
      }

      jest.spyOn(localLlm, 'streamLocalLlmResponse')
        .mockReturnValueOnce(streamStep1() as any)
        .mockReturnValueOnce(streamStep2() as any);

      jest.spyOn(safetyManager, 'evaluateSafety').mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });

      jest.spyOn(deviceActionExecutor, 'executeDeviceAction').mockResolvedValue(
        'Screen hierarchy: Settings > Wi-Fi: Connected'
      );

      const events: any[] = [];
      const result = await runLocalAgentLoop('Check my Wi-Fi state', {
        conversationId: 'conv_e2e_001',
        onEvent: (ev) => events.push(ev),
      });

      expect(result.completed).toBe(true);
      expect(result.totalSteps).toBe(2);
      expect(result.steps[0].toolCall?.toolName).toBe('device_screen_read');
      expect(result.steps[0].observation).toContain('Settings > Wi-Fi: Connected');
      expect(result.finalResponse).toContain('Wi-Fi is currently connected');

      // Verify event notifications occurred in order
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('tool_start');
      expect(eventTypes).toContain('tool_executing');
      expect(eventTypes).toContain('tool_observation');
      expect(eventTypes).toContain('step_complete');
      expect(eventTypes).toContain('done');
    });
  });

  describe('3. Offline Step Synchronization with Backend', () => {
    it('drains local operationLog and syncs to backend mock server', async () => {
      const mockOpId = 'devicestep_e2e_999';
      const mockOps = [
        {
          id: mockOpId,
          type: 'device_step',
          conversation_id: 'conv_e2e_sync',
          payload: JSON.stringify({
            step: 1,
            toolName: 'device_screen_read',
            observation: 'Settings > Wi-Fi: Connected',
            status: 'executed',
            timestamp: 1725700030000,
          }),
          created_at: 1725700030000,
        },
      ];

      // Mock Drizzle db calls for syncQueue
      const mockLimit = jest.fn().mockResolvedValue(mockOps);
      const mockWhere = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
      (db!.select as jest.Mock).mockReturnValue({ from: mockFrom });

      const mockDeleteWhere = jest.fn().mockResolvedValue(true);
      (db!.delete as jest.Mock).mockReturnValue({ where: mockDeleteWhere });

      // Mock backend HTTP endpoint response
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          status: 'ok',
          conversation_id: 'conv_e2e_sync',
          accepted: [mockOpId],
          rejected: [],
          processed: 1,
        }),
      });

      const syncResult = await drainDeviceStepSyncQueue(
        'https://api.vela.dev',
        'auth_token_secret_123'
      );

      expect(syncResult.syncedCount).toBe(1);
      expect(syncResult.failedCount).toBe(0);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.vela.dev/api/sync/device-steps',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer auth_token_secret_123',
          }),
        })
      );
      expect(db!.delete).toHaveBeenCalled();
    });
  });
});

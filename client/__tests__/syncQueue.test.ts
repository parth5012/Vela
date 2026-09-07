import { drainDeviceStepSyncQueue } from '../db/syncQueue';
import { db } from '../db/client';
import { operationLog } from '../db/schema';

jest.mock('../db/client', () => {
  const mockSelect = jest.fn();
  const mockInsert = jest.fn();
  const mockDelete = jest.fn();

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
    },
  };
});

describe('syncQueue - Drizzle SQLite device-step batch sync', () => {
  const mockApiUrl = 'https://api.example.com';
  const mockApiKey = 'test_api_key_123';

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('drains pending device steps and removes accepted items from operationLog', async () => {
    const mockPendingOps = [
      {
        id: 'devicestep_1',
        type: 'device_step',
        conversation_id: 'conv_123',
        payload: JSON.stringify({
          step: 1,
          toolName: 'device_screen_read',
          observation: 'Screen tree: Settings',
          status: 'executed',
          timestamp: 1725700000000,
        }),
        created_at: 1725700000000,
      },
    ];

    const mockWhere = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue(mockPendingOps),
    });
    const mockFrom = jest.fn().mockReturnValue({
      where: mockWhere,
    });
    (db!.select as jest.Mock).mockReturnValue({
      from: mockFrom,
    });

    const mockDeleteWhere = jest.fn().mockResolvedValue(true);
    (db!.delete as jest.Mock).mockReturnValue({
      where: mockDeleteWhere,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        status: 'ok',
        accepted: ['devicestep_1'],
        processed: 1,
      }),
    });

    const result = await drainDeviceStepSyncQueue(mockApiUrl, mockApiKey);

    expect(result.syncedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/sync/device-steps',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test_api_key_123',
        }),
      })
    );
    expect(db!.delete).toHaveBeenCalled();
  });

  it('handles empty queue without making network requests', async () => {
    const mockWhere = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue([]),
    });
    (db!.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({ where: mockWhere }),
    });

    const result = await drainDeviceStepSyncQueue(mockApiUrl, mockApiKey);

    expect(result.syncedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('preserves items in operationLog on network failure', async () => {
    const mockPendingOps = [
      {
        id: 'devicestep_failed',
        type: 'device_step',
        conversation_id: 'conv_failed',
        payload: JSON.stringify({
          toolName: 'device_click',
          status: 'executed',
        }),
        created_at: 1725700000000,
      },
    ];

    const mockWhere = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue(mockPendingOps),
    });
    (db!.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({ where: mockWhere }),
    });

    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network offline'));

    const result = await drainDeviceStepSyncQueue(mockApiUrl, mockApiKey);

    expect(result.syncedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(db!.delete).not.toHaveBeenCalled();
  });
});

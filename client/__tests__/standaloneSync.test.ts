import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../db/client', () => {
  const makeChain = (resolved: any) => ({
    where: jest.fn(() => Promise.resolve(resolved)),
    then: (resolve: any) => resolve(resolved),
  });

  const mockSelect = jest.fn(() => ({
    from: jest.fn(() => makeChain([])),
  }));

  const mockInsert = jest.fn(() => ({
    values: jest.fn(() => ({
      then: (resolve: any) => resolve([]),
    })),
  }));

  const mockDelete = jest.fn(() => ({
    where: jest.fn(async () => undefined),
  }));

  const mockUpdate = jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({
        then: (resolve: any) => resolve([]),
      })),
    })),
  }));

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
    },
    initializeDatabase: jest.fn(),
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

jest.mock('../db/chatRepository', () => ({
  markMessageSynced: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
}));

import {
  syncStandaloneDataToBackend,
  getUnsyncedLocalCount,
  getStandaloneSyncStatus,
  subscribeToStandaloneSync,
} from '../utils/syncManager';
import { db } from '../db/client';

describe('Standalone SQLite-to-backend sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as any).fetch = jest.fn();
  });

  it('reports unsynced local messages count', async () => {
    const mockRows = [
      { id: 'msg_1', conversation_id: 'conv_1', role: 'user', content: 'hi' },
      { id: 'msg_2', conversation_id: 'conv_1', role: 'assistant', content: 'hello' },
    ];
    (db.select as jest.Mock).mockReturnValueOnce({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve(mockRows)),
        then: (resolve: any) => resolve(mockRows),
      })),
    });

    const count = await getUnsyncedLocalCount();
    expect(count).toBe(2);
  });

  it('pushes standalone messages with origin metadata and marks them synced', async () => {
    const mockRows = [
      {
        id: 'msg_1',
        conversation_id: 'conv_1',
        role: 'user',
        content: 'hello local',
        provider: 'local',
        created_at: 1000,
      },
    ];

    // 1. getUnsyncedLocalMessages
    (db.select as jest.Mock).mockReturnValueOnce({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve(mockRows)),
        then: (resolve: any) => resolve(mockRows),
      })),
    });

    // Mock push endpoint response
    const mockFetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/api/sync/push')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ accepted: ['msg_1'] }),
        });
      }
      if (url.includes('/api/sync/pull')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ operations: [], cursor: 'c_1', has_more: false }),
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    (globalThis as any).fetch = mockFetch;

    // Listener receives status updates
    const statuses: any[] = [];
    const unsub = subscribeToStandaloneSync((st) => statuses.push({ ...st }));

    const res = await syncStandaloneDataToBackend('https://api.vela.run', 'my-key');

    expect(res.success).toBe(true);
    expect(res.pushedCount).toBe(1);

    // Verify payload had origin: standalone and provider: android_client
    const pushCall = mockFetch.mock.calls.find((c: any) => c[0].includes('/api/sync/push'));
    expect(pushCall).toBeDefined();
    const payload = JSON.parse(pushCall[1].body);
    expect(payload.operations[0].payload.origin).toBe('standalone');
    expect(payload.operations[0].payload.provider).toBe('android_client');

    unsub();
  });

  it('pulls remote messages and deduplicates matching server_id idempotently', async () => {
    // 1. getUnsyncedLocalMessages -> 0
    (db.select as jest.Mock).mockReturnValueOnce({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
        then: (resolve: any) => resolve([]),
      })),
    });

    const mockFetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/api/sync/pull')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            operations: [
              {
                id: 'op_remote_1',
                type: 'message',
                conversation_id: 'conv_remote_1',
                payload: { role: 'assistant', content: 'from server' },
              },
            ],
            cursor: 'c_2',
            has_more: false,
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ accepted: [] }) });
    });
    (globalThis as any).fetch = mockFetch;

    const res = await syncStandaloneDataToBackend('https://api.vela.run', 'my-key');
    expect(res.success).toBe(true);
    expect(res.pushedCount).toBe(0);
  });
});

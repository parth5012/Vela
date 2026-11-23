import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncConflictStore } from '../store/useSyncConflictStore';

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

import { syncDatabase } from '../utils/syncManager';
import { db } from '../db/client';

globalThis.fetch = jest.fn();

describe('Sync conflict detection in syncDatabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis.fetch as jest.Mock).mockReset();
    AsyncStorage.clear();
    useSyncConflictStore.getState().clearConflicts();
  });

  it('detects conflict when pulled message differs from pending local message', async () => {
    // Push phase: no pending ops
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
        then: (resolve: any) => resolve([]),
      })),
    }));

    // Pull phase returns 1 operation
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        operations: [
          {
            id: 'msg_100',
            type: 'message',
            conversation_id: 'conv_1',
            payload: {
              role: 'user',
              content: 'Remote content from server',
              created_at: 2000,
              provider: 'remote',
            },
          },
        ],
        cursor: 'cursor_test',
        has_more: false,
      }),
    });

    // 1st select in pull: thread check (exists)
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([{ id: 'conv_1' }])),
        then: (resolve: any) => resolve([{ id: 'conv_1' }]),
      })),
    }));

    // 2nd select in pull: message lookup returns existing local message that is pending
    const localExistingMessage = {
      id: 'msg_100',
      conversation_id: 'conv_1',
      role: 'user',
      content: 'Local pending content edited offline',
      created_at: 1000,
      pending: true,
      provider: 'android_client',
      server_id: null,
    };

    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([localExistingMessage])),
        then: (resolve: any) => resolve([localExistingMessage]),
      })),
    }));

    await syncDatabase('https://api.vela.run', 'test_key');

    // Conflict must be registered in useSyncConflictStore
    const conflicts = useSyncConflictStore.getState().conflicts;
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].id).toBe('msg_100');
    expect(conflicts[0].localMessage.content).toBe('Local pending content edited offline');
    expect(conflicts[0].serverMessage.content).toBe('Remote content from server');

    // db.update must NOT have been called for this conflicted message (preserved until user decision)
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates message normally without conflict if local message is not pending', async () => {
    // Push phase: no pending ops
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
        then: (resolve: any) => resolve([]),
      })),
    }));

    // Pull phase returns 1 operation
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        operations: [
          {
            id: 'msg_200',
            type: 'message',
            conversation_id: 'conv_1',
            payload: {
              role: 'assistant',
              content: 'Authoritative server update',
              created_at: 2000,
              provider: 'remote',
            },
          },
        ],
        cursor: 'cursor_test_2',
        has_more: false,
      }),
    });

    // 1st select in pull: thread check
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([{ id: 'conv_1' }])),
        then: (resolve: any) => resolve([{ id: 'conv_1' }]),
      })),
    }));

    // 2nd select in pull: existing message with pending = false
    const syncedMessage = {
      id: 'msg_200',
      conversation_id: 'conv_1',
      role: 'assistant',
      content: 'Old content',
      created_at: 1000,
      pending: false,
      provider: 'remote',
      server_id: 'msg_200',
    };

    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([syncedMessage])),
        then: (resolve: any) => resolve([syncedMessage]),
      })),
    }));

    await syncDatabase('https://api.vela.run', 'test_key');

    // No conflict added
    expect(useSyncConflictStore.getState().conflicts).toEqual([]);

    // db.update was called to apply server update
    expect(db.update).toHaveBeenCalled();
  });
});

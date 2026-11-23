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
    // 1. Pull phase: fetch returns 1 operation
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

    // 3rd select (Push phase): operationLog select returns the pending operation for msg_100
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() =>
          Promise.resolve([
            {
              id: 'msg_100',
              type: 'message',
              conversation_id: 'conv_1',
              payload: JSON.stringify({
                role: 'user',
                content: 'Local pending content edited offline',
                provider: 'android_client',
                created_at: 1000,
              }),
              created_at: 1000,
            },
          ])
        ),
        then: (resolve: any) =>
          resolve([
            {
              id: 'msg_100',
              type: 'message',
              conversation_id: 'conv_1',
              payload: JSON.stringify({
                role: 'user',
                content: 'Local pending content edited offline',
                provider: 'android_client',
                created_at: 1000,
              }),
              created_at: 1000,
            },
          ]),
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

    // Push fetch must NOT have been called because the active conflict was excluded from push
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('updates message normally without conflict if local message is not pending', async () => {
    // 1. Pull phase returns 1 operation
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

    // Push phase: no pending ops
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
        then: (resolve: any) => resolve([]),
      })),
    }));

    await syncDatabase('https://api.vela.run', 'test_key');

    // No conflict added
    expect(useSyncConflictStore.getState().conflicts).toEqual([]);

    // db.update was called to apply server update
    expect(db.update).toHaveBeenCalled();
  });

  it('excludes pending operations with active conflicts while pushing non-conflicted operations', async () => {
    // 1. Pull phase: empty pull
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        operations: [],
        cursor: 'cursor_test_3',
        has_more: false,
      }),
    });

    // Pre-populate an active conflict
    useSyncConflictStore.getState().addConflict({
      id: 'msg_conflict_x',
      conversation_id: 'conv_1',
      localMessage: {
        id: 'msg_conflict_x',
        role: 'user',
        content: 'Local text',
        created_at: 1000,
        provider: 'android_client',
        conversation_id: 'conv_1',
      },
      serverMessage: {
        id: 'msg_conflict_x',
        role: 'user',
        content: 'Server text',
        created_at: 2000,
        provider: 'remote',
        conversation_id: 'conv_1',
      },
    });

    // 2. Push phase: 2 pending operations (1 conflicted, 1 normal)
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() =>
          Promise.resolve([
            {
              id: 'msg_conflict_x',
              type: 'message',
              conversation_id: 'conv_1',
              payload: JSON.stringify({ role: 'user', content: 'Local text' }),
              created_at: 1000,
            },
            {
              id: 'msg_normal_y',
              type: 'message',
              conversation_id: 'conv_1',
              payload: JSON.stringify({ role: 'assistant', content: 'Normal text' }),
              created_at: 1100,
            },
          ])
        ),
        then: (resolve: any) =>
          resolve([
            {
              id: 'msg_conflict_x',
              type: 'message',
              conversation_id: 'conv_1',
              payload: JSON.stringify({ role: 'user', content: 'Local text' }),
              created_at: 1000,
            },
            {
              id: 'msg_normal_y',
              type: 'message',
              conversation_id: 'conv_1',
              payload: JSON.stringify({ role: 'assistant', content: 'Normal text' }),
              created_at: 1100,
            },
          ]),
      })),
    }));

    // Push fetch response
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ['msg_normal_y'], rejected: [] }),
    });

    await syncDatabase('https://api.vela.run', 'test_key');

    // 2 fetch calls: 1 pull, 1 push
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const pushCall = (globalThis.fetch as jest.Mock).mock.calls.find((c: any[]) =>
      c[0].endsWith('/api/sync/push')
    );
    expect(pushCall).toBeDefined();
    const pushBody = JSON.parse(pushCall[1].body);
    expect(pushBody.operations.length).toBe(1);
    expect(pushBody.operations[0].id).toBe('msg_normal_y');
  });
});

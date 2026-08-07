import AsyncStorage from '@react-native-async-storage/async-storage';

// Self-contained mock at the very top to satisfy hoisting without ReferenceError
jest.mock('../db/client', () => {
  const mockSelect = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        then: (resolve: any) => resolve([]),
      })),
      then: (resolve: any) => resolve([]),
    })),
  }));

  const mockInsert = jest.fn(() => ({
    values: jest.fn(() => ({
      then: (resolve: any) => resolve([]),
    })),
  }));

  const mockDelete = jest.fn(() => ({
    where: jest.fn(() => ({
      then: (resolve: any) => resolve([]),
    })),
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
    }
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Import the tested function and dependencies
import { syncDatabase } from '../utils/syncManager';
import { db } from '../db/client';

global.fetch = jest.fn();

describe('syncDatabase engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
    AsyncStorage.clear();
  });

  it('should skip sync if operation log is empty and no remote items pulled', async () => {
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        then: (resolve: any) => resolve([]), // No pending ops
      })),
    }));

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [], cursor: 'cursor_123', has_more: false }),
    });

    await syncDatabase('https://api.vela.run', 'test_key');

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1); // just one pull
  });

  it('should push pending operations and delete them on success', async () => {
    const mockPendingOps = [
      { id: 'op_1', type: 'message', conversation_id: 'conv_1', payload: JSON.stringify({ role: 'user', content: 'test' }), created_at: Date.now() },
    ];

    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        then: (resolve: any) => resolve(mockPendingOps),
      })),
    }));

    // Post to push
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ['op_1'], rejected: [] }),
    });

    // Get for pull
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [], cursor: 'cursor_123', has_more: false }),
    });

    await syncDatabase('https://api.vela.run', 'test_key');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});

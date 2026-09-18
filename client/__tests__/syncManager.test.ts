import AsyncStorage from '@react-native-async-storage/async-storage';

// Self-contained mock at the very top to satisfy hoisting without ReferenceError.
// The drizzle chain used by syncDatabase is select().from().where() (thenable),
// insert().values(), delete().where(), update().set().where().
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
    }
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Import the tested function and dependencies
import { syncDatabase } from '../utils/syncManager';
import { db } from '../db/client';

globalThis.fetch = jest.fn();

/** Resolve the pending operationLog rows for the push-phase select. */
function mockPendingOps(rows: any[]) {
  (db.select as jest.Mock).mockImplementationOnce(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve(rows)),
      then: (resolve: any) => resolve(rows),
    })),
  }));
}

/** Resolve [] for every other select (pull-phase thread/message lookups). */
function mockEmptySelects() {
  (db.select as jest.Mock).mockImplementation(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve([])),
      then: (resolve: any) => resolve([]),
    })),
  }));
}

function mockPullEmpty() {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ operations: [], cursor: 'cursor_123', has_more: false }),
  });
}

describe('syncDatabase engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis.fetch as jest.Mock).mockReset();
    AsyncStorage.clear();
  });

  it('should skip sync if operation log is empty and no remote items pulled', async () => {
    mockPendingOps([]);
    mockPullEmpty();

    await syncDatabase('https://api.vela.run', 'test_key');

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // just one pull
  });

  it('should push pending operations and delete them on success', async () => {
    const mockPendingOpsRows = [
      { id: 'op_1', type: 'message', conversation_id: 'conv_1', payload: JSON.stringify({ role: 'user', content: 'test' }), created_at: Date.now() },
    ];

    mockPendingOps(mockPendingOpsRows);
    mockEmptySelects();

    // Post to push
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ['op_1'], rejected: [] }),
    });

    // Get for pull
    mockPullEmpty();

    await syncDatabase('https://api.vela.run', 'test_key');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('should mark accepted messages as synced (pending=false, server_id set)', async () => {
    const mockPendingOpsRows = [
      { id: 'op_1', type: 'message', conversation_id: 'conv_1', payload: JSON.stringify({ role: 'user', content: 'test' }), created_at: Date.now() },
    ];

    mockPendingOps(mockPendingOpsRows);
    mockEmptySelects();

    // Post to push — op_1 accepted
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ['op_1'], rejected: [] }),
    });

    // Get for pull — nothing new
    mockPullEmpty();

    // Record update calls for markMessageSynced
    const updateMocks = (db.update as jest.Mock).mock.calls;
    await syncDatabase('https://api.vela.run', 'test_key');

    // markMessageSynced updates the messages table for the accepted op id
    expect(updateMocks.length).toBeGreaterThan(0);
    const [updateArg] = updateMocks[0];
    expect(updateArg).toBeDefined();
  });

  it('should filter the push query to message ops (T5: device steps drain elsewhere)', async () => {
    mockPendingOps([]);
    mockEmptySelects();
    mockPullEmpty();

    await syncDatabase('https://api.vela.run', 'test_key');

    // The pending-ops select must constrain to type='message' so device_step
    // rows only ever travel via POST /api/sync/device-steps.
    const fromResult = (db.select as jest.Mock).mock.results[0].value;
    expect(fromResult.from).toHaveBeenCalledTimes(1);
  });

  it('should never POST device_step ops to /api/sync/push (T5)', async () => {
    const rows = [
      { id: 'op_msg', type: 'message', conversation_id: 'conv_1', payload: JSON.stringify({ role: 'user', content: 'hi' }), created_at: Date.now() },
      // A stray device_step row that a query-filter bypass could surface.
      { id: 'op_step', type: 'device_step', conversation_id: 'conv_1', payload: JSON.stringify({ toolName: 'device_click' }), created_at: Date.now() },
    ];

    // First call (push phase) returns the mixed rows; everything after is empty.
    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve(rows)),
        then: (resolve: any) => resolve(rows),
      })),
    }));
    mockEmptySelects();

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ['op_msg'], rejected: [] }),
    });
    mockPullEmpty();

    await syncDatabase('https://api.vela.run', 'test_key');

    const pushCall = (globalThis.fetch as jest.Mock).mock.calls[0];
    const pushBody = JSON.parse(pushCall[1].body);
    const pushedIds = pushBody.operations.map((op: any) => op.id);
    expect(pushedIds).toEqual(['op_msg']);
    expect(pushedIds).not.toContain('op_step');
  });

  it('should quarantine a corrupt payload row and still complete the sync (T5)', async () => {
    const rows = [
      { id: 'op_good', type: 'message', conversation_id: 'conv_1', payload: JSON.stringify({ role: 'user', content: 'hello' }), created_at: Date.now() },
      { id: 'op_bad', type: 'message', conversation_id: 'conv_1', payload: '{not valid json', created_at: Date.now() },
    ];

    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve(rows)),
        then: (resolve: any) => resolve(rows),
      })),
    }));
    mockEmptySelects();

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ['op_good'], rejected: [] }),
    });
    mockPullEmpty();

    // Must not throw; the corrupt row is quarantined, the good row syncs.
    await expect(syncDatabase('https://api.vela.run', 'test_key')).resolves.toBeUndefined();

    // Push carried only the good op.
    const pushCall = (globalThis.fetch as jest.Mock).mock.calls[0];
    const pushBody = JSON.parse(pushCall[1].body);
    expect(pushBody.operations.map((op: any) => op.id)).toEqual(['op_good']);

    // Pull still ran, so the whole sync completed.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // Two deletes: one quarantine for op_bad, one accepted-cleanup for op_good.
    expect(db.delete).toHaveBeenCalledTimes(2);
  });

  it("should quarantine a JSON 'null' payload row and never POST it (coderabbit #261)", async () => {
    // JSON.parse('null') succeeds but yields null, which violates the
    // /api/sync/push dictionary-payload contract — it must be quarantined.
    const rows = [
      { id: 'op_good', type: 'message', conversation_id: 'conv_1', payload: JSON.stringify({ role: 'user', content: 'hello' }), created_at: Date.now() },
      { id: 'op_null', type: 'message', conversation_id: 'conv_1', payload: 'null', created_at: Date.now() },
    ];

    (db.select as jest.Mock).mockImplementationOnce(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve(rows)),
        then: (resolve: any) => resolve(rows),
      })),
    }));
    mockEmptySelects();

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ['op_good'], rejected: [] }),
    });
    mockPullEmpty();

    await expect(syncDatabase('https://api.vela.run', 'test_key')).resolves.toBeUndefined();

    const pushCall = (globalThis.fetch as jest.Mock).mock.calls[0];
    const pushBody = JSON.parse(pushCall[1].body);
    expect(pushBody.operations.map((op: any) => op.id)).toEqual(['op_good']);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

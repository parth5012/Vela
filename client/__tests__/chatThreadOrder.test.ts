// T5 (#253): addMessage must persist the bumped thread updated_at alongside
// the message so SQLite ordering (loadThreads: updated_at DESC) matches the
// in-memory order after an app restart.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Non-null db so repository writes execute against a chainable mock and the
// persisted rows can be inspected.
const valuesCalls: any[] = [];
jest.mock('../db/client', () => {
  const mockSelect = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(async () => []),
      })),
    })),
  }));
  const mockInsert = jest.fn(() => ({
    values: jest.fn((row: any) => {
      valuesCalls.push(row);
      return {
        onConflictDoUpdate: jest.fn(async () => undefined),
        onConflictDoNothing: jest.fn(async () => undefined),
      };
    }),
  }));
  const mockDelete = jest.fn(() => ({
    where: jest.fn(async () => undefined),
  }));
  const mockUpdate = jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(async () => undefined),
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
    expoDb: null,
    default: null,
  };
});

import { useChatStore } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chat thread order persistence (T5)', () => {
  beforeEach(async () => {
    valuesCalls.length = 0;
    jest.clearAllMocks();
    useChatStore.getState().clearStore();
    useConfigStore.getState().clearConfig();
    await flush();
    valuesCalls.length = 0;
  });

  it('persists saveThread(updated_at) alongside saveMessage on addMessage', async () => {
    const store = useChatStore.getState();
    store.createThread('Thread 1', 't1');
    store.createThread('Thread 2', 't2');
    await flush();
    valuesCalls.length = 0;

    // New message on the OLDER thread bumps it to front in memory...
    store.addMessage('t1', { id: 'm1', role: 'user', content: 'hello' });
    expect(useChatStore.getState().threads.map((t) => t.id)).toEqual(['t1', 't2']);
    await flush();

    // ...and the bumped updated_at must reach SQLite, or restart ordering
    // (loadThreads ORDER BY updated_at DESC) would disagree.
    const memoryThread = useChatStore.getState().threads.find((t) => t.id === 't1');
    expect(memoryThread).toBeDefined();

    const threadRows = valuesCalls.filter((row) => row.id === 't1' && 'title' in row);
    expect(threadRows.length).toBeGreaterThan(0);
    const lastThreadRow = threadRows[threadRows.length - 1];
    expect(lastThreadRow.updated_at).toBe(memoryThread!.updated_at);

    // The message itself is still persisted too.
    const messageRows = valuesCalls.filter(
      (row) => row.conversation_id === 't1' && row.content === 'hello'
    );
    expect(messageRows.length).toBeGreaterThan(0);
  });
});

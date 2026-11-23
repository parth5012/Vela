import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../db/client', () => {
  const makeChain = (resolved: any): any => ({
    where: jest.fn(() => Promise.resolve(resolved)),
    then: (resolve: any) => resolve(resolved),
    orderBy: jest.fn(() => makeChain(resolved)),
  });

  const mockSelect = jest.fn(() => ({
    from: jest.fn(() => makeChain([])),
  }));

  const mockInsert = jest.fn(() => ({
    values: jest.fn(() => ({
      onConflictDoNothing: jest.fn(() => Promise.resolve([])),
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

import { useSyncConflictStore, type SyncConflict } from '../store/useSyncConflictStore';
import { useChatStore } from '../store/useChatStore';
import { db } from '../db/client';

describe('useSyncConflictStore', () => {
  const sampleConflict: SyncConflict = {
    id: 'msg_conflict_1',
    conversation_id: 'conv_1',
    localMessage: {
      id: 'msg_conflict_1',
      role: 'user',
      content: 'Local text edited offline',
      created_at: 1000,
      provider: 'android_client',
      conversation_id: 'conv_1',
    },
    serverMessage: {
      id: 'msg_conflict_1',
      role: 'user',
      content: 'Server remote text',
      created_at: 2000,
      provider: 'remote',
      conversation_id: 'conv_1',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useSyncConflictStore.getState().clearConflicts();
    useChatStore.setState({
      messages: {
        conv_1: [
          {
            id: 'msg_conflict_1',
            role: 'user',
            content: 'Local text edited offline',
            created_at: new Date(1000).toISOString(),
          },
        ],
      },
    });
  });

  it('starts with empty conflicts', () => {
    expect(useSyncConflictStore.getState().conflicts).toEqual([]);
  });

  it('adds a conflict and deduplicates by id', () => {
    const store = useSyncConflictStore.getState();
    store.addConflict(sampleConflict);
    expect(useSyncConflictStore.getState().conflicts.length).toBe(1);

    // Duplicate add should be ignored
    store.addConflict(sampleConflict);
    expect(useSyncConflictStore.getState().conflicts.length).toBe(1);
  });

  it('removes conflict by id', () => {
    const store = useSyncConflictStore.getState();
    store.addConflict(sampleConflict);
    expect(useSyncConflictStore.getState().conflicts.length).toBe(1);

    store.removeConflict(sampleConflict.id);
    expect(useSyncConflictStore.getState().conflicts.length).toBe(0);
  });

  it('resolves conflict with "local"', async () => {
    const store = useSyncConflictStore.getState();
    store.addConflict(sampleConflict);

    await store.resolveConflict('msg_conflict_1', 'local');

    // Confirmed removed from conflict list
    expect(useSyncConflictStore.getState().conflicts).toEqual([]);

    // Confirmed db operations: marked pending = true in messages, inserted into operationLog
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it('resolves conflict with "server"', async () => {
    const store = useSyncConflictStore.getState();
    store.addConflict(sampleConflict);

    await store.resolveConflict('msg_conflict_1', 'server');

    // Removed from store
    expect(useSyncConflictStore.getState().conflicts).toEqual([]);

    // Messages updated with server content, pending = false
    expect(db.update).toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalled();

    // In-memory chat store updated
    const updatedMessages = useChatStore.getState().messages['conv_1'];
    expect(updatedMessages[0].content).toBe('Server remote text');
  });

  it('resolves conflict with "both"', async () => {
    const store = useSyncConflictStore.getState();
    store.addConflict(sampleConflict);

    await store.resolveConflict('msg_conflict_1', 'both');

    // Removed from store
    expect(useSyncConflictStore.getState().conflicts).toEqual([]);

    // 1. Original message updated to server version
    expect(db.update).toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalled();

    // 2. Duplicate local message inserted
    expect(db.insert).toHaveBeenCalled();

    // 3. In-memory chat store updated with both original and duplicate
    const convMessages = useChatStore.getState().messages['conv_1'];
    expect(convMessages.length).toBe(2);
    expect(convMessages[0].content).toBe('Server remote text');
    expect(convMessages[1].content).toBe('Local text edited offline *');
  });
});

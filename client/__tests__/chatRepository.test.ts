// @ts-nocheck
// Self-contained mock of the db client so repository tests never touch
// expo-sqlite. Mirrors the pattern used in syncManager.test.ts.
jest.mock('../db/client', () => {
  const mockSelect = jest.fn();
  const mockInsert = jest.fn();
  const mockDelete = jest.fn();
  const mockUpdate = jest.fn();

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

import { db } from '../db/client';
import {
  saveThread,
  saveThreads,
  saveMessage,
  saveMessages,
  deleteThreadLocal,
  deleteMessageLocal,
  replaceThreadMessages,
  loadThreads,
  loadMessages,
  clearChatLocal,
  isLocalDbAvailable,
  queueMessageForSync,
  markMessageSynced,
} from '../db/chatRepository';

describe('chatRepository (local-first chat persistence)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isLocalDbAvailable', () => {
    it('should report the mocked db as available', () => {
      expect(isLocalDbAvailable()).toBe(true);
    });
  });

  describe('saveThread', () => {
    it('should upsert a thread with default persona/pin', async () => {
      const valuesFn = jest.fn(() => ({
        onConflictDoUpdate: jest.fn(async () => undefined),
      }));
      (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesFn });

      await saveThread({
        id: 'thread-1',
        title: 'My Thread',
        updated_at: '2026-08-16T10:00:00.000Z',
      });

      expect(db.insert).toHaveBeenCalledTimes(1);
      const insertArg = valuesFn.mock.calls[0][0];
      expect(insertArg.id).toBe('thread-1');
      expect(insertArg.persona).toBe('personal assistant');
      expect(insertArg.is_pinned).toBe(false);
    });
  });

  describe('saveThreads', () => {
    it('should persist each thread in the list', async () => {
      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn(async () => undefined),
        })),
      });

      await saveThreads([
        { id: 't1', title: 'One', updated_at: '2026-08-16T10:00:00.000Z' },
        { id: 't2', title: 'Two', updated_at: '2026-08-16T10:00:00.000Z' },
      ]);

      expect(db.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe('saveMessage', () => {
    it('should persist a message with sync metadata defaults', async () => {
      const valuesFn = jest.fn(() => ({
        onConflictDoUpdate: jest.fn(async () => undefined),
      }));
      (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesFn });

      await saveMessage('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        created_at: '2026-08-16T10:00:00.000Z',
      });

      const row = valuesFn.mock.calls[0][0];
      expect(row.conversation_id).toBe('thread-1');
      expect(row.role).toBe('user');
      expect(row.content).toBe('hello');
      expect(row.provider).toBe('local');
      expect(row.pending).toBe(false);
      expect(row.server_id).toBeNull();
      expect(row.created_at).toBe(Date.parse('2026-08-16T10:00:00.000Z'));
    });
  });

  describe('queueMessageForSync', () => {
    it('should persist message as pending and write an operation_log entry', async () => {
      const valuesMocks: jest.Mock[] = [];
      (db.insert as jest.Mock).mockImplementation(() => ({
        values: (() => {
          const fn = jest.fn(() => ({
            onConflictDoUpdate: jest.fn(async () => undefined),
            onConflictDoNothing: jest.fn(async () => undefined),
          }));
          valuesMocks.push(fn);
          return fn;
        })(),
      }));

      await queueMessageForSync('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'offline hello',
        created_at: '2026-08-16T10:00:00.000Z',
      });

      expect(db.insert).toHaveBeenCalledTimes(2);
      expect(valuesMocks.length).toBe(2);

      // First insert: messages table with pending=true
      const messageRow = valuesMocks[0].mock.calls[0][0];
      expect(messageRow.pending).toBe(true);
      expect(messageRow.conversation_id).toBe('thread-1');

      // Second insert: operation_log with android_client provider payload
      const opRow = valuesMocks[1].mock.calls[0][0];
      expect(opRow.type).toBe('message');
      expect(opRow.conversation_id).toBe('thread-1');
      const payload = JSON.parse(opRow.payload);
      expect(payload.provider).toBe('android_client');
      expect(payload.role).toBe('user');
      expect(payload.content).toBe('offline hello');
    });
  });

  describe('markMessageSynced', () => {
    it('should clear pending and set server_id for the message', async () => {
      const whereFn = jest.fn(async () => undefined);
      const setFn = jest.fn(() => ({ where: whereFn }));
      (db.update as jest.Mock).mockReturnValueOnce({ set: setFn });

      await markMessageSynced('msg-1', 'server-1');

      expect(db.update).toHaveBeenCalledTimes(1);
      const setArg = setFn.mock.calls[0][0];
      expect(setArg.pending).toBe(false);
      expect(setArg.server_id).toBe('server-1');
    });
  });

  describe('saveMessages', () => {
    it('should persist each message in the list', async () => {
      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn(async () => undefined),
        })),
      });

      await saveMessages('thread-1', [
        { id: 'm1', role: 'user', content: 'a' },
        { id: 'm2', role: 'assistant', content: 'b' },
      ]);

      expect(db.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe('replaceThreadMessages', () => {
    it('should delete existing rows then re-insert the given list', async () => {
      const whereFn = jest.fn(async () => undefined);
      (db.delete as jest.Mock).mockReturnValueOnce({ where: whereFn });
      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn(async () => undefined),
        })),
      });

      await replaceThreadMessages('thread-1', [{ id: 'm1', role: 'user', content: 'a' }]);

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(whereFn).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteThreadLocal / deleteMessageLocal / clearChatLocal', () => {
    it('should delete a thread by id', async () => {
      const whereFn = jest.fn(async () => undefined);
      (db.delete as jest.Mock).mockReturnValueOnce({ where: whereFn });

      await deleteThreadLocal('thread-1');
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(whereFn).toHaveBeenCalledTimes(1);
    });

    it('should delete a message by id', async () => {
      const whereFn = jest.fn(async () => undefined);
      (db.delete as jest.Mock).mockReturnValueOnce({ where: whereFn });

      await deleteMessageLocal('msg-1');
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(whereFn).toHaveBeenCalledTimes(1);
    });

    it('should clear messages then threads', async () => {
      (db.delete as jest.Mock).mockReturnValue(async () => undefined);

      await clearChatLocal();
      expect(db.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadThreads', () => {
    it('should map rows back to store Thread shape', async () => {
      const orderByFn = jest.fn(async () => [
        { id: 't1', title: 'One', persona: 'assistant', updated_at: '2026-08-16T10:00:00.000Z', is_pinned: 1 },
      ]);
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn(() => ({ orderBy: orderByFn })),
      });

      const threads = await loadThreads();
      expect(threads).toEqual([
        {
          id: 't1',
          title: 'One',
          persona: 'assistant',
          updated_at: '2026-08-16T10:00:00.000Z',
          is_pinned: true,
        },
      ]);
    });
  });

  describe('loadMessages', () => {
    it('should map rows back to store Message shape', async () => {
      const whereFn = jest.fn(() => ({
        orderBy: jest.fn(async () => [
          { id: 'm1', role: 'user', content: 'hello', created_at: 1750000000000 },
        ]),
      }));
      (db.select as jest.Mock).mockReturnValueOnce({
        from: jest.fn(() => ({ where: whereFn })),
      });

      const messages = await loadMessages('t1');
      expect(messages).toEqual([
        { id: 'm1', role: 'user', content: 'hello', created_at: '2025-06-15T15:06:40.000Z' },
      ]);
    });
  });
});


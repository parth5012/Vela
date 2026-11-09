/**
 * Chat repository (#548) — local-first chat persistence verified against a
 * real in-memory SQLite database via __tests__/helpers/memoryDb.ts.
 *
 * `../db/client` is replaced with a drizzle sqlite-proxy instance backed by
 * `node:sqlite` `:memory:` running the shipped migrations, so persistence,
 * upsert, delete and migration behaviour (the thing under test) is exercised
 * unmocked — only the storage transport is swapped. This replaces the old
 * self-contained mock that asserted on mocked query-builder calls.
 *
 * The one genuinely unit-level test (`configurePragmas`) stays: it asserts on
 * `expo-sqlite` pragma statements, not repository SQL. It follows the same
 * `jest.requireActual` pattern as the old suite.
 */
jest.mock('../db/client', () => {
  const { createMemoryDbClientModule } = require('./helpers/memoryDb');
  return createMemoryDbClientModule();
});

import {
  clearChatLocal,
  deleteMessageLocal,
  deleteThreadLocal,
  hydrateChatFromLocalDb,
  isLocalDbAvailable,
  loadMessages,
  loadThreads,
  markMessageSynced,
  queueMessageForSync,
  replaceThreadMessages,
  saveMessage,
  saveMessages,
  saveMessagesBatch,
  saveThread,
  saveThreads,
} from '../db/chatRepository';
import { useChatStore } from '../store/useChatStore';
import { perfTracker } from '../utils/perfTracker';
import { reset as resetMetrics, snapshot as metricSnapshot } from '../utils/metrics';
import {
  STORAGE_QUERY_COUNT_METRIC as STORAGE_QUERY_COUNT,
  STORAGE_QUERY_DURATION_METRIC as STORAGE_QUERY_DURATION,
  THREAD_LIST_MAX_QUERIES,
} from '../utils/storageMetrics';

const sqlite: any = jest.requireMock('../db/client').__sqlite;

function resetTables(): void {
  sqlite.exec('DELETE FROM operation_log');
  sqlite.exec('DELETE FROM messages');
  sqlite.exec('DELETE FROM threads');
}

function threadRow(id: string): any {
  return sqlite.prepare('SELECT * FROM threads WHERE id = ?').get(id);
}

function messageRow(id: string): any {
  return sqlite.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

function operationRow(id: string): any {
  return sqlite.prepare('SELECT * FROM operation_log WHERE id = ?').get(id);
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return Number(row.n);
}

const THREAD_TIME = '2026-08-16T10:00:00.000Z';
const MSG_TIME = '2026-08-16T10:00:00.000Z';

describe('chatRepository on real in-memory SQLite (#548)', () => {
  beforeEach(() => {
    resetTables();
    useChatStore.setState({ threads: [], activeThreadId: null, messages: {} });
  });

  describe('migrations and schema', () => {
    it('applies the shipped migrations (threads/messages/operation_log columns)', () => {
      const columns = (table: string): string[] =>
        (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((row) => row.name);

      expect(columns('threads')).toEqual(
        expect.arrayContaining([
          'id',
          'title',
          'agent',
          'updated_at',
          'is_pinned',
          'active_skill',
        ])
      );
      expect(columns('messages')).toEqual(
        expect.arrayContaining([
          'id',
          'conversation_id',
          'role',
          'content',
          'provider',
          'created_at',
          'pending',
          'server_id',
        ])
      );
      expect(columns('operation_log')).toEqual(
        expect.arrayContaining(['id', 'type', 'conversation_id', 'payload', 'created_at'])
      );
    });
  });

  describe('isLocalDbAvailable', () => {
    it('reports the real database as available', () => {
      expect(isLocalDbAvailable()).toBe(true);
    });
  });

  describe('saveThread', () => {
    it('persists a thread with default agent/pin and reads it back', async () => {
      await saveThread({ id: 'thread-1', title: 'My Thread', updated_at: THREAD_TIME });

      expect(await loadThreads()).toEqual([
        {
          id: 'thread-1',
          title: 'My Thread',
          agent: 'personal assistant',
          updated_at: THREAD_TIME,
          is_pinned: false,
        },
      ]);
    });

    it('upserts an existing thread id instead of duplicating it', async () => {
      await saveThread({ id: 'thread-1', title: 'Old title', updated_at: THREAD_TIME });
      await saveThread({
        id: 'thread-1',
        title: 'New title',
        agent: 'analyst',
        is_pinned: true,
        updated_at: '2026-08-17T10:00:00.000Z',
      });

      const threads = await loadThreads();
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({
        title: 'New title',
        agent: 'analyst',
        is_pinned: true,
        updated_at: '2026-08-17T10:00:00.000Z',
      });
    });

    it('persists an explicit active_skill', async () => {
      await saveThread({
        id: 'thread-1',
        title: 'T',
        updated_at: THREAD_TIME,
        active_skill: 'skill-1',
      });

      expect((await loadThreads())[0]).toMatchObject({ active_skill: 'skill-1' });
      expect(threadRow('thread-1').active_skill).toBe('skill-1');
    });
  });

  describe('saveThreads', () => {
    it('persists each thread and lists them newest-first', async () => {
      await saveThreads([
        { id: 't1', title: 'One', updated_at: '2026-08-16T10:00:00.000Z' },
        { id: 't2', title: 'Two', updated_at: '2026-08-17T10:00:00.000Z' },
      ]);

      expect((await loadThreads()).map((t) => t.id)).toEqual(['t2', 't1']);
    });
  });

  describe('saveMessage', () => {
    it('persists a message with sync metadata defaults and reads it back', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessage('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        created_at: MSG_TIME,
      });

      const row = messageRow('msg-1');
      expect(row).toMatchObject({
        conversation_id: 'thread-1',
        role: 'user',
        content: 'hello',
        provider: 'local',
        pending: 0,
        created_at: Date.parse(MSG_TIME),
      });
      expect(row.server_id).toBeNull();

      expect(await loadMessages('thread-1')).toEqual([
        { id: 'msg-1', role: 'user', content: 'hello', created_at: MSG_TIME },
      ]);
    });

    it('upserts an existing message id instead of duplicating it', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessage('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        created_at: MSG_TIME,
      });
      await saveMessage('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'edited',
        created_at: MSG_TIME,
      });

      const messages = await loadMessages('thread-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('edited');
      expect(countRows('messages')).toBe(1);
    });

    it('creates the parent thread from the in-memory store when the db row is missing', async () => {
      useChatStore.setState({
        threads: [{ id: 'thread-1', title: 'From store', updated_at: THREAD_TIME }],
        messages: {},
        activeThreadId: 'thread-1',
      });

      await saveMessage('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        created_at: MSG_TIME,
      });

      expect(threadRow('thread-1')).toMatchObject({ id: 'thread-1', title: 'From store' });
      expect((await loadMessages('thread-1')).map((m) => m.id)).toEqual(['msg-1']);
    });
  });

  describe('queueMessageForSync', () => {
    it('persists the message as pending and writes an operation_log entry', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await queueMessageForSync('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'offline hello',
        created_at: MSG_TIME,
      });

      expect(messageRow('msg-1')).toMatchObject({
        conversation_id: 'thread-1',
        pending: 1,
      });

      const op = operationRow('msg-1');
      expect(op).toMatchObject({ type: 'message', conversation_id: 'thread-1' });
      const payload = JSON.parse(op.payload as string);
      expect(payload).toMatchObject({
        provider: 'android_client',
        role: 'user',
        content: 'offline hello',
        created_at: Date.parse(MSG_TIME),
      });
    });

    it('is idempotent per message id (no duplicate operation_log row)', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      const message = {
        id: 'msg-1',
        role: 'user' as const,
        content: 'offline hello',
        created_at: MSG_TIME,
      };
      await queueMessageForSync('thread-1', message);
      await queueMessageForSync('thread-1', message);

      expect(countRows('messages')).toBe(1);
      expect(countRows('operation_log')).toBe(1);
      expect(messageRow('msg-1').pending).toBe(1);
    });
  });

  describe('markMessageSynced', () => {
    it('clears pending and sets server_id for the message', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await queueMessageForSync('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'hi',
        created_at: MSG_TIME,
      });

      await markMessageSynced('msg-1', 'server-1');

      expect(messageRow('msg-1')).toMatchObject({ pending: 0, server_id: 'server-1' });
      expect((await loadMessages('thread-1')).map((m) => m.id)).toEqual(['msg-1']);
    });
  });

  describe('saveMessages', () => {
    it('persists each message and lists them in created-time order', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessages('thread-1', [
        { id: 'm2', role: 'assistant', content: 'b', created_at: '2026-08-16T10:01:00.000Z' },
        { id: 'm1', role: 'user', content: 'a', created_at: MSG_TIME },
      ]);

      expect((await loadMessages('thread-1')).map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(countRows('messages')).toBe(2);
    });
  });

  describe('saveMessagesBatch', () => {
    it('persists the whole batch in one call', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessagesBatch('thread-1', [
        { id: 'm1', role: 'user', content: 'hello', created_at: MSG_TIME },
        { id: 'm2', role: 'assistant', content: 'world', created_at: '2026-08-16T10:01:00.000Z' },
      ]);

      expect((await loadMessages('thread-1')).map((m) => m.id)).toEqual(['m1', 'm2']);
    });

    it('is a no-op for an empty list', async () => {
      await saveMessagesBatch('thread-1', []);

      expect(countRows('messages')).toBe(0);
    });
  });

  describe('replaceThreadMessages', () => {
    it('deletes existing rows then re-inserts the given list', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessages('thread-1', [
        { id: 'm1', role: 'user', content: 'a', created_at: MSG_TIME },
        { id: 'm2', role: 'assistant', content: 'b', created_at: '2026-08-16T10:01:00.000Z' },
      ]);

      await replaceThreadMessages('thread-1', [
        { id: 'm3', role: 'user', content: 'c', created_at: '2026-08-16T10:02:00.000Z' },
      ]);

      expect((await loadMessages('thread-1')).map((m) => m.id)).toEqual(['m3']);
      expect(countRows('messages')).toBe(1);
    });
  });

  describe('deleteThreadLocal / deleteMessageLocal / clearChatLocal', () => {
    it('deletes a thread by id', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveThread({ id: 'thread-2', title: 'U', updated_at: THREAD_TIME });

      await deleteThreadLocal('thread-1');

      expect(threadRow('thread-1')).toBeUndefined();
      expect((await loadThreads()).map((t) => t.id)).toEqual(['thread-2']);
    });

    it('deletes a message by id', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessages('thread-1', [
        { id: 'm1', role: 'user', content: 'a', created_at: MSG_TIME },
        { id: 'm2', role: 'assistant', content: 'b', created_at: '2026-08-16T10:01:00.000Z' },
      ]);

      await deleteMessageLocal('m1');

      expect((await loadMessages('thread-1')).map((m) => m.id)).toEqual(['m2']);
    });

    it('clears messages and threads', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessage('thread-1', {
        id: 'm1',
        role: 'user',
        content: 'a',
        created_at: MSG_TIME,
      });

      await clearChatLocal();

      expect(await loadThreads()).toEqual([]);
      expect(await loadMessages('thread-1')).toEqual([]);
      expect(countRows('threads')).toBe(0);
      expect(countRows('messages')).toBe(0);
    });
  });

  describe('loadThreads / loadMessages on an empty database', () => {
    it('returns empty lists', async () => {
      expect(await loadThreads()).toEqual([]);
      expect(await loadMessages('missing-thread')).toEqual([]);
    });
  });

  describe('SQLite WAL & Performance Telemetry', () => {
    it('records sqlite_insert_duration_ms and sqlite_query_duration_ms metrics', async () => {
      perfTracker.reset();
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessage('thread-1', {
        id: 'm-perf',
        role: 'user',
        content: 'perf',
        created_at: MSG_TIME,
      });
      await loadMessages('thread-1');

      const summary = perfTracker.flush();
      expect(summary.sqlite_insert_duration_ms?.count).toBeGreaterThanOrEqual(1);
      expect(summary.sqlite_query_duration_ms?.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('storage query metrics (#505)', () => {
    it('increments storage.query.count on loadThreads', async () => {
      resetMetrics();
      await loadThreads();

      expect(metricSnapshot().counters[STORAGE_QUERY_COUNT]).toBe(1);
      expect(metricSnapshot().stats[STORAGE_QUERY_DURATION]?.count).toBe(1);
    });

    it('increments storage.query.count on loadMessages', async () => {
      resetMetrics();
      await loadMessages('t1');

      expect(metricSnapshot().counters[STORAGE_QUERY_COUNT]).toBe(1);
      expect(metricSnapshot().stats[STORAGE_QUERY_DURATION]?.count).toBe(1);
    });

    it('keeps loadThreads/loadMessages query count within the thread-list budget', async () => {
      resetMetrics();
      await loadThreads();
      await loadMessages('t1');

      expect(metricSnapshot().counters[STORAGE_QUERY_COUNT]).toBeLessThanOrEqual(
        THREAD_LIST_MAX_QUERIES
      );
    });
  });

  describe('configurePragmas (unit)', () => {
    it('configures WAL, busy_timeout, and synchronous pragmas', () => {
      const execSyncMock = jest.fn();
      const { configurePragmas } = jest.requireActual('../db/client');
      configurePragmas({ execSync: execSyncMock });

      expect(execSyncMock).toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');
      expect(execSyncMock).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000;');
      expect(execSyncMock).toHaveBeenCalledWith('PRAGMA synchronous = NORMAL;');
    });
  });

  describe('hydrateChatFromLocalDb', () => {
    it('hydrates threads and history from SQLite', async () => {
      await saveThread({ id: 'thread-1', title: 'T', updated_at: THREAD_TIME });
      await saveMessage('thread-1', {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        created_at: MSG_TIME,
      });

      await hydrateChatFromLocalDb();

      const state = useChatStore.getState();
      expect(state.threads.map((t) => t.id)).toEqual(['thread-1']);
      expect(state.messages['thread-1']).toEqual([
        { id: 'msg-1', role: 'user', content: 'hello', created_at: MSG_TIME },
      ]);
      expect(state.activeThreadId).toBe('thread-1');
    });

    it('leaves the store untouched when SQLite is empty', async () => {
      useChatStore.setState({
        threads: [{ id: 'keep-me', title: 'Keep', updated_at: THREAD_TIME }],
        messages: {},
        activeThreadId: 'keep-me',
      });

      await hydrateChatFromLocalDb();

      expect(useChatStore.getState().threads.map((t) => t.id)).toEqual(['keep-me']);
    });
  });
});

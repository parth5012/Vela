jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
  })),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({
    query: {},
  })),
}));

jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({
  migrate: jest.fn(async () => Promise.resolve()),
}));

import { threads, messages, operationLog, tasks, taskRuns, messageVectors } from '../db/schema';
import db, { initializeDatabase } from '../db/client';
import { applyMigrations, migrationKeys, migrationTags } from './helpers/sqliteMigrations';

describe('Database client schema', () => {
  it('should define correct tables schema', () => {
    expect(threads).toBeDefined();
    expect(messages).toBeDefined();
    expect(operationLog).toBeDefined();
    expect(tasks).toBeDefined();
    expect(taskRuns).toBeDefined();
  });

  it('should have correct columns defined in threads table', () => {
    expect(threads.id).toBeDefined();
    expect(threads.title).toBeDefined();
    expect(threads.agent).toBeDefined();
    expect(threads.updated_at).toBeDefined();
    expect(threads.is_pinned).toBeDefined();
  });

  it('should have correct columns defined in messages table', () => {
    expect(messages.id).toBeDefined();
    expect(messages.conversation_id).toBeDefined();
    expect(messages.role).toBeDefined();
    expect(messages.content).toBeDefined();
    expect(messages.provider).toBeDefined();
    expect(messages.created_at).toBeDefined();
    expect(messages.pending).toBeDefined();
    expect(messages.server_id).toBeDefined();
  });

  it('should default pending to false and allow nullable server_id', () => {
    // Drizzle column builders expose default/sqlType metadata; assert defaults.
    expect(messages.pending.default).toBe(false);
    expect(messages.server_id.notNull).toBe(false);
    expect(messages.pending.notNull).toBe(true);
  });

  it('should have correct columns defined in operationLog table', () => {
    expect(operationLog.id).toBeDefined();
    expect(operationLog.type).toBeDefined();
    expect(operationLog.conversation_id).toBeDefined();
    expect(operationLog.payload).toBeDefined();
    expect(operationLog.created_at).toBeDefined();
  });

  it('should compile and export initializeDatabase', () => {
    expect(initializeDatabase).toBeDefined();
  });

  it('should execute migrations when initializeDatabase is called', async () => {
    const { migrate } = require('drizzle-orm/expo-sqlite/migrator');
    await initializeDatabase();
    expect(migrate).toHaveBeenCalled();
  });
});

describe('message_vectors schema (#299)', () => {
  it('defines the side table for per-message vectors', () => {
    expect(messageVectors).toBeDefined();
    expect(messageVectors.message_id).toBeDefined();
    expect(messageVectors.embedding).toBeDefined();
    expect(messageVectors.model).toBeDefined();
    expect(messageVectors.created_at).toBeDefined();
  });

  it('keys vectors by message id with provenance columns', () => {
    expect(messageVectors.message_id.primary).toBe(true);
    expect(messageVectors.message_id.notNull).toBe(true);
    expect(messageVectors.embedding.notNull).toBe(true);
    expect(messageVectors.model.notNull).toBe(true);
    expect(messageVectors.created_at.notNull).toBe(true);
  });

  it('registers migrations through 0007 in the drizzle bundle and journal', () => {
    const keys = migrationKeys();
    expect(keys).toContain('m0005');
    expect(keys).toContain('m0006');
    expect(keys).toContain('m0007');
    expect(keys[keys.length - 1]).toBe('m0007');

    const tags = migrationTags();
    expect(tags[tags.length - 1]).toMatch(/^0007_/);
  });

  it('creates message_vectors in the 0005 migration SQL', () => {
    const sql = (require('../db/migrations/migrations').default.migrations.m0005 as string) || '';
    expect(sql).toContain('CREATE TABLE `message_vectors`');
    expect(sql).toContain('REFERENCES `messages`');
    expect(sql).toMatch(/ON DELETE cascade/i);
  });

  it('adds active_skill to threads in the 0006 migration SQL', () => {
    const sql = (require('../db/migrations/migrations').default.migrations.m0006 as string) || '';
    expect(sql).toContain('ALTER TABLE `threads` ADD `active_skill`');
  });
});

describe('migrations apply to a real SQLite database (#299)', () => {
  it('applies 0000..0005 in order and cascades vector rows when a message is deleted', () => {
    const { DatabaseSync } = require('node:sqlite');
    const sqlite = new DatabaseSync(':memory:');
    // expo-sqlite enables foreign keys by default; mirror that here so the
    // cascade declared in migration 0005 is actually enforceable.
    sqlite.exec('PRAGMA foreign_keys = ON');
    applyMigrations(sqlite);

    sqlite
      .prepare(
        'INSERT INTO threads (id, title, agent, updated_at, is_pinned) VALUES (?, ?, ?, ?, ?)'
      )
      .run('t1', 'title', 'personal assistant', '2026-01-01', 0);
    sqlite
      .prepare(
        'INSERT INTO messages (id, conversation_id, role, content, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('m1', 't1', 'user', 'the railway was delayed', 'local', 1);

    const insertVector = sqlite.prepare(
      'INSERT INTO message_vectors (message_id, embedding, model, created_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(message_id) DO UPDATE SET embedding = excluded.embedding, model = excluded.model, created_at = excluded.created_at'
    );
    insertVector.run('m1', JSON.stringify([1, 0, 0]), 'needle3-probe-pool', 1);
    // Second write for the same message upserts instead of failing on the PK.
    insertVector.run('m1', JSON.stringify([1, 0, 1]), 'needle3-probe-pool', 2);

    const rows = sqlite
      .prepare('SELECT embedding FROM message_vectors WHERE message_id = ?')
      .all('m1') as { embedding: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].embedding)).toEqual([1, 0, 1]);

    sqlite.prepare('DELETE FROM messages WHERE id = ?').run('m1');
    const after = sqlite.prepare('SELECT * FROM message_vectors').all();
    expect(after).toHaveLength(0);
  });
});

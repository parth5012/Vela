/**
 * Agent repository (#357) — list/get/insert/update/delete/duplicate plus the
 * server-mode merge overlay, exercised against the shipped schema.
 *
 * `../db/client` is replaced with a drizzle sqlite-proxy instance backed by an
 * in-memory node:sqlite database so the real migrations run without an Android
 * runtime (mirrors __tests__/helpers/sqliteMigrations.ts usage elsewhere).
 */
jest.mock('../db/client', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { drizzle } = require('drizzle-orm/sqlite-proxy');
  const { applyMigrations } = require('./helpers/sqliteMigrations');

  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);

  const columnNames = (stmt: any): string[] => {
    try {
      return stmt.columns().map((column: any) => column.name);
    } catch (error) {
      return [];
    }
  };

  const asArrays = (rows: any[], names: string[]) =>
    rows.map((row) => (names.length > 0 ? names.map((name) => row[name]) : Object.values(row)));

  const client = async (sql: string, params: any[], method: 'run' | 'all' | 'values' | 'get') => {
    const stmt = sqlite.prepare(sql);
    if (method === 'run') {
      stmt.run(...params);
      return { rows: [] };
    }
    const names = columnNames(stmt);
    const rows = stmt.all(...params);
    if (method === 'get') {
      if (rows.length === 0) return { rows: undefined };
      return { rows: asArrays(rows.slice(0, 1), names)[0] };
    }
    return { rows: asArrays(rows, names) };
  };

  const db = drizzle(client);

  return {
    db,
    default: db,
    expoDb: null,
    initializeDatabase: jest.fn(async () => {}),
    __sqlite: sqlite,
  };
});

import {
  listAgents,
  getAgent,
  insertAgent,
  updateAgent,
  deleteAgent,
  duplicateAgent,
  overlayRemoteAgents,
  refreshAgents,
} from '../db/agentRepository';
import { db } from '../db/client';
import { useConfigStore } from '../store/useConfigStore';

const sqlite: any = jest.requireMock('../db/client').__sqlite;

function resetTables(): void {
  sqlite.exec('DELETE FROM messages');
  sqlite.exec('DELETE FROM threads');
  sqlite.exec('DELETE FROM agents');
}

function seedThread(id: string, agent: string): void {
  sqlite
    .prepare('INSERT INTO threads (id, title, agent, updated_at, is_pinned) VALUES (?, ?, ?, ?, 0)')
    .run(id, `Thread ${id}`, agent, new Date().toISOString());
}

describe('agentRepository (#357)', () => {
  beforeEach(async () => {
    resetTables();
    useConfigStore.getState().setDefaultAgent('personal assistant');
    await refreshAgents();
  });

  describe('insertAgent / listAgents / getAgent', () => {
    it('inserts a non-preset agent with a slug id and reads it back', async () => {
      const created = await insertAgent({ name: 'My Great Agent', system_prompt: 'be great' });

      expect(created).not.toBeNull();
      expect(created!.id).toBe('my-great-agent');
      expect(created!.is_preset).toBe(false);
      expect(created!.system_prompt).toBe('be great');

      const fetched = await getAgent('my-great-agent');
      expect(fetched).toEqual(created);
    });

    it('honours an explicit id and keeps presets ahead of custom agents', async () => {
      await insertAgent({ id: 'zzz-preset', name: 'Zed', system_prompt: '', is_preset: true });
      await insertAgent({ id: 'aaa-custom', name: 'Ada', system_prompt: '' });

      const ids = (await listAgents()).map((a) => a.id);
      expect(ids).toEqual(['zzz-preset', 'aaa-custom']);
    });

    it('returns null for an unknown id', async () => {
      expect(await getAgent('does-not-exist')).toBeNull();
    });
  });

  describe('updateAgent', () => {
    it('patches fields and bumps updated_at', async () => {
      await insertAgent({ id: 'analyst', name: 'Analyst', system_prompt: 'v1' });
      const before = await getAgent('analyst');

      const updated = await updateAgent('analyst', { name: 'Senior Analyst', system_prompt: 'v2' });

      expect(updated!.name).toBe('Senior Analyst');
      expect(updated!.system_prompt).toBe('v2');
      const beforeUpdatedAt = before?.updated_at ?? '';
      const afterUpdatedAt = updated?.updated_at ?? '';
      expect(afterUpdatedAt).not.toBe('');
      expect(afterUpdatedAt >= beforeUpdatedAt).toBe(true);
      expect((await getAgent('analyst'))!.system_prompt).toBe('v2');
    });

    it('returns null when the agent does not exist', async () => {
      expect(await updateAgent('nope', { name: 'x' })).toBeNull();
    });
  });

  describe('duplicateAgent', () => {
    it('copies the row with is_preset = 0, a new slug id and " copy" suffix', async () => {
      await insertAgent({
        id: 'analyst',
        name: 'Analyst',
        description: 'data',
        icon: '📊',
        system_prompt: 'v1',
        compact_prompt_instructions: 'compact v1',
        is_preset: true,
      });

      const copy = await duplicateAgent('analyst');

      expect(copy).not.toBeNull();
      expect(copy!.id).toBe('analyst-copy');
      expect(copy!.name).toBe('Analyst copy');
      expect(copy!.is_preset).toBe(false);
      expect(copy!.system_prompt).toBe('v1');
      expect(copy!.compact_prompt_instructions).toBe('compact v1');
      expect(copy!.icon).toBe('📊');

      // the original is untouched and still a preset
      const original = await getAgent('analyst');
      expect(original!.is_preset).toBe(true);
      expect((await listAgents()).map((a) => a.id)).toEqual(['analyst', 'analyst-copy']);
    });

    it('avoids colliding with an existing duplicate id', async () => {
      await insertAgent({ id: 'analyst', name: 'Analyst', system_prompt: 'v1' });
      await duplicateAgent('analyst');
      const second = await duplicateAgent('analyst');
      expect(second!.id).toBe('analyst-copy-2');
    });

    it('returns null for an unknown id', async () => {
      expect(await duplicateAgent('does-not-exist')).toBeNull();
    });
  });

  describe('deleteAgent', () => {
    it('re-points every thread using the agent to config.defaultAgent before deleting', async () => {
      useConfigStore.getState().setDefaultAgent('analyst');
      await insertAgent({ id: 'analyst', name: 'Analyst', system_prompt: '' });
      await insertAgent({ id: 'teacher', name: 'Teacher', system_prompt: '' });
      seedThread('t-1', 'teacher');
      seedThread('t-2', 'teacher');

      const ok = await deleteAgent('teacher');

      expect(ok).toBe(true);
      expect(await getAgent('teacher')).toBeNull();
      const rows = sqlite.prepare('SELECT id, agent FROM threads ORDER BY id').all();
      expect(rows).toEqual([
        { id: 't-1', agent: 'analyst' },
        { id: 't-2', agent: 'analyst' },
      ]);
    });

    it('refuses to delete the last remaining agent (floor of one)', async () => {
      await insertAgent({ id: 'analyst', name: 'Analyst', system_prompt: '' });
      seedThread('t-1', 'analyst');

      expect(await deleteAgent('analyst')).toBe(false);
      expect(await getAgent('analyst')).not.toBeNull();
      expect(sqlite.prepare('SELECT agent FROM threads WHERE id = ?').get('t-1')).toEqual({
        agent: 'analyst',
      });
    });

    it('re-points threads to a surviving agent when the deleted agent is the default', async () => {
      useConfigStore.getState().setDefaultAgent('analyst');
      await insertAgent({ id: 'analyst', name: 'Analyst', system_prompt: '' });
      await insertAgent({ id: 'teacher', name: 'Teacher', system_prompt: '' });
      seedThread('t-1', 'analyst');

      expect(await deleteAgent('analyst')).toBe(true);

      expect(sqlite.prepare('SELECT agent FROM threads WHERE id = ?').get('t-1')).toEqual({
        agent: 'teacher',
      });
      expect(useConfigStore.getState().defaultAgent).toBe('teacher');
    });

    it('is a no-op for an unknown id', async () => {
      await insertAgent({ id: 'analyst', name: 'Analyst', system_prompt: '' });
      expect(await deleteAgent('does-not-exist')).toBe(false);
      expect(await listAgents()).toHaveLength(1);
    });
  });

  describe('overlayRemoteAgents (server-mode merge overlay)', () => {
    it('keeps a locally-created agent alive when remote rows arrive', async () => {
      await insertAgent({ id: 'my-custom', name: 'My Custom', system_prompt: 'local only' });

      await overlayRemoteAgents([
        { id: 'analyst', name: 'Analyst', compact_prompt_instructions: 'from server' },
      ]);

      const ids = (await listAgents()).map((a) => a.id);
      expect(ids).toContain('my-custom');
      expect((await getAgent('my-custom'))!.system_prompt).toBe('local only');
    });

    it('overlays remote rows onto local rows by id instead of replacing them', async () => {
      await insertAgent({
        id: 'analyst',
        name: 'Analyst',
        system_prompt: 'kept',
        compact_prompt_instructions: 'local compact',
        is_preset: true,
      });

      await overlayRemoteAgents([
        { id: 'analyst', name: 'Analyst (server)', compact_prompt_instructions: 'server compact' },
      ]);

      const merged = await getAgent('analyst');
      expect(merged!.name).toBe('Analyst (server)');
      expect(merged!.compact_prompt_instructions).toBe('server compact');
      // fields the remote does not carry must survive the overlay
      expect(merged!.system_prompt).toBe('kept');
      expect(merged!.is_preset).toBe(true);
      expect(merged!.icon).toBe('📊');
    });

    it('appends remote-only rows so they show up in the selector', async () => {
      await overlayRemoteAgents([
        { id: 'google_workspace', name: 'Workspace', compact_prompt_instructions: 'remote' },
      ]);

      const added = await getAgent('google_workspace');
      expect(added).not.toBeNull();
      expect(added!.compact_prompt_instructions).toBe('remote');
      expect(added!.icon).toBe('🤖');
    });

    it('never adopts is_preset from the remote payload (preset stays preset)', async () => {
      await insertAgent({ id: 'analyst', name: 'Analyst', system_prompt: 'seed', is_preset: true });

      await overlayRemoteAgents([
        { id: 'analyst', name: 'Analyst (server)', is_preset: false },
      ]);

      expect((await getAgent('analyst'))!.is_preset).toBe(true);
    });

    it('forces remote-only and remote-overwritten custom rows to is_preset false', async () => {
      await insertAgent({ id: 'my-custom', name: 'My Custom', system_prompt: 'local', is_preset: false });

      await overlayRemoteAgents([
        { id: 'my-custom', name: 'My Custom (server)', is_preset: true },
        { id: 'device_agent', name: 'Device Agent', is_preset: true },
      ]);

      expect((await getAgent('my-custom'))!.is_preset).toBe(false);
      expect((await getAgent('device_agent'))!.is_preset).toBe(false);
    });
  });
});

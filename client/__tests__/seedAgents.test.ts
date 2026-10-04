import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './helpers/sqliteMigrations';
import {
  PRESET_AGENTS,
  DEFAULT_SYSTEM_PROMPT,
  seedPresetAgents,
  migrateLegacySystemPrompt,
  runAgentBootstrap,
  SqlRunner,
} from '../utils/seedAgents';

const PRESET_IDS = ['personal assistant', 'teacher', 'analyst', 'prompt builder'];
const REGISTRY_PATH = path.resolve(__dirname, '..', '..', 'backend', 'agent', 'registry.py');

function readPythonStringDict(source: string, from: string, to: string): Record<string, string> {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`markers not found in registry.py: ${from} / ${to}`);
  const block = source.slice(start, end);
  const out: Record<string, string> = {};
  const entry = /"([^"]+)":\s*(?:"""([\s\S]*?)"""|""\s*,?)/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(block)) !== null) {
    out[match[1]] = match[2] || '';
  }
  return out;
}

function readPythonRegistry(): {
  prompts: Record<string, string>;
  compact: Record<string, string>;
  meta: Record<string, { display_name: string; description: string }>;
} {
  const source = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const prompts = readPythonStringDict(source, 'AGENT_PROMPTS: dict[str, str]', 'COMPACT_PROMPTS: dict[str, str]');
  const compact = readPythonStringDict(source, 'COMPACT_PROMPTS: dict[str, str]', '_registry = AgentRegistry()');
  const meta: Record<string, { display_name: string; description: string }> = {};
  const registers = /identifier="([^"]+)",\s*display_name="([^"]+)",\s*description="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = registers.exec(source)) !== null) {
    meta[match[1]] = { display_name: match[2], description: match[3] };
  }
  return { prompts, compact, meta };
}

function makeRunner(db: DatabaseSync): SqlRunner {
  return {
    all: <T,>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])) as unknown as T[],
    run: (sql: string, params: unknown[] = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
  };
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function agentRows(db: DatabaseSync): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM agents ORDER BY id').all() as Record<string, unknown>[];
}

function agentById(db: DatabaseSync, id: string): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`agent row not found: ${id}`);
  return row;
}

describe('seedPresetAgents (#356)', () => {
  const registry = readPythonRegistry();

  it('seeds exactly the four curated presets with is_preset = 1', () => {
    const db = freshDb();
    seedPresetAgents(makeRunner(db), '2026-01-01T00:00:00.000Z');

    const rows = agentRows(db);
    expect(rows.map((r) => r.id).sort()).toEqual([...PRESET_IDS].sort());
    for (const row of rows) {
      expect(row.is_preset).toBe(1);
      expect(row.model).toBeNull();
      expect(row.created_at).toBe('2026-01-01T00:00:00.000Z');
      expect(row.updated_at).toBe('2026-01-01T00:00:00.000Z');
      expect(typeof row.name).toBe('string');
      expect((row.name as string).length).toBeGreaterThan(0);
      expect(typeof row.icon).toBe('string');
      expect((row.icon as string).length).toBeGreaterThan(0);
    }
    db.close();
  });

  it('copies system prompts and compact prompts byte-identically from backend/agent/registry.py', () => {
    const db = freshDb();
    seedPresetAgents(makeRunner(db), '2026-01-01T00:00:00.000Z');

    for (const id of PRESET_IDS) {
      const row = agentById(db, id);
      expect(row.system_prompt).toBe(registry.prompts[id]);
      expect(row.compact_prompt_instructions).toBe(registry.compact[id]);
      expect(row.name).toBe(registry.meta[id].display_name);
      expect(row.description).toBe(registry.meta[id].description);
    }
    db.close();
  });

  it('seeds the prompts listed in the ticket table (guard against a parser slip)', () => {
    const db = freshDb();
    seedPresetAgents(makeRunner(db), '2026-01-01T00:00:00.000Z');

    expect(agentById(db, 'personal assistant').system_prompt).toBe('');
    expect(agentById(db, 'teacher').system_prompt).toContain(
      'Identity/Role: You are a friendly, encouraging, and knowledgeable Teacher.'
    );
    expect(agentById(db, 'analyst').compact_prompt_instructions).toContain(
      '<role>Sharp, logical, and detail-oriented Analyst.</role>'
    );
    expect(agentById(db, 'prompt builder').system_prompt).toContain(
      'Keep instructions highly actionable, avoiding vague words like "think carefully".'
    );
    expect(agentRows(db)).toHaveLength(4);
    db.close();
  });

  it('does not seed the deferred tool-bound agents', () => {
    const db = freshDb();
    seedPresetAgents(makeRunner(db), '2026-01-01T00:00:00.000Z');
    const ids = agentRows(db).map((r) => r.id);
    for (const deferred of ['google_workspace', 'device_agent', 'check-in', 'coder']) {
      expect(ids).not.toContain(deferred);
    }
    db.close();
  });

  it('is idempotent when run repeatedly', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    seedPresetAgents(runner, '2026-01-01T00:00:00.000Z');
    const first = agentRows(db);

    seedPresetAgents(runner, '2026-01-02T00:00:00.000Z');
    seedPresetAgents(runner, '2026-01-03T00:00:00.000Z');

    const rows = agentRows(db);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.id).sort()).toEqual([...PRESET_IDS].sort());
    expect(rows.map((r) => r.is_preset)).toEqual(first.map((r) => r.is_preset));
    expect(rows.map((r) => r.system_prompt)).toEqual(first.map((r) => r.system_prompt));
    db.close();
  });

  it('re-syncs a drifted preset row to the bundled seed on every run', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    seedPresetAgents(runner, '2026-01-01T00:00:00.000Z');
    // A preset row that no longer matches the bundle (legacy edit, or a
    // stale install) must be brought back to the canonical seed so prompt
    // updates actually ship to existing installs.
    db.prepare('UPDATE agents SET system_prompt = ? WHERE id = ?').run('my rewritten teacher prompt', 'teacher');

    seedPresetAgents(runner, '2026-01-02T00:00:00.000Z');

    expect(agentById(db, 'teacher').system_prompt).toBe(registry.prompts.teacher);
    expect(agentById(db, 'analyst').system_prompt).toBe(registry.prompts.analyst);
    db.close();
  });

  it('never overwrites a user-owned row (is_preset = 0) that reuses a preset id', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    seedPresetAgents(runner, '2026-01-01T00:00:00.000Z');
    db.prepare('UPDATE agents SET system_prompt = ?, is_preset = 0 WHERE id = ?').run(
      'user owned prompt',
      'teacher'
    );

    seedPresetAgents(runner, '2026-01-02T00:00:00.000Z');

    const row = agentById(db, 'teacher');
    expect(row.system_prompt).toBe('user owned prompt');
    expect(row.is_preset).toBe(0);
    db.close();
  });

  it('leaves unrelated custom agents alone', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    seedPresetAgents(runner, '2026-01-01T00:00:00.000Z');
    db.prepare(
      'INSERT INTO agents (id, name, system_prompt, is_preset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('my-prompt', 'My prompt', 'custom system prompt', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    seedPresetAgents(runner, '2026-01-02T00:00:00.000Z');

    expect(agentRows(db)).toHaveLength(5);
    expect(agentById(db, 'my-prompt').system_prompt).toBe('custom system prompt');
    db.close();
  });
});

describe('migrateLegacySystemPrompt (#356)', () => {
  it('does nothing while systemPrompt is still the shipped default', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    seedPresetAgents(runner, '2026-01-01T00:00:00.000Z');

    const result = migrateLegacySystemPrompt(runner, DEFAULT_SYSTEM_PROMPT, '2026-01-01T00:00:00.000Z');

    expect(result).toBeNull();
    expect(agentRows(db)).toHaveLength(4);
    db.close();
  });

  it('turns a customized systemPrompt into a custom agent and reports its id', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    seedPresetAgents(runner, '2026-01-01T00:00:00.000Z');

    const id = migrateLegacySystemPrompt(runner, 'my customized research prompt', '2026-01-01T00:00:00.000Z');

    expect(id).toBeTruthy();
    const row = agentById(db, id as string);
    expect(row.system_prompt).toBe('my customized research prompt');
    expect(row.is_preset).toBe(0);
    expect(row.name).toBe('My prompt');
    db.close();
  });

  it('is idempotent across launches', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    seedPresetAgents(runner, '2026-01-01T00:00:00.000Z');
    const first = migrateLegacySystemPrompt(runner, 'my customized research prompt', '2026-01-01T00:00:00.000Z');

    db.prepare('UPDATE agents SET system_prompt = ? WHERE id = ?').run('user edited later', first as string);
    const second = migrateLegacySystemPrompt(runner, 'my customized research prompt', '2026-01-02T00:00:00.000Z');
    const third = migrateLegacySystemPrompt(runner, 'my customized research prompt', '2026-01-03T00:00:00.000Z');

    expect(second).toBeNull();
    expect(third).toBeNull();
    expect(agentRows(db)).toHaveLength(5);
    expect(agentById(db, first as string).system_prompt).toBe('user edited later');
    db.close();
  });
});

describe('runAgentBootstrap (#356)', () => {
  it('seeds presets and points defaultAgent at the migrated custom agent', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    const setDefaultAgent = jest.fn();

    runAgentBootstrap(runner, { systemPrompt: 'my customized research prompt', setDefaultAgent });

    expect(agentRows(db)).toHaveLength(5);
    const custom = agentRows(db).find((r) => r.is_preset === 0) as Record<string, unknown>;
    expect(custom).toBeDefined();
    expect(custom.system_prompt).toBe('my customized research prompt');
    expect(setDefaultAgent).toHaveBeenCalledTimes(1);
    expect(setDefaultAgent).toHaveBeenCalledWith(custom.id);

    runAgentBootstrap(runner, { systemPrompt: 'my customized research prompt', setDefaultAgent });
    expect(agentRows(db)).toHaveLength(5);
    expect(setDefaultAgent).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('leaves defaultAgent alone when systemPrompt was never customized', () => {
    const db = freshDb();
    const runner = makeRunner(db);
    const setDefaultAgent = jest.fn();

    runAgentBootstrap(runner, { systemPrompt: DEFAULT_SYSTEM_PROMPT, setDefaultAgent });

    expect(agentRows(db)).toHaveLength(4);
    expect(setDefaultAgent).not.toHaveBeenCalled();
    db.close();
  });

  it('still seeds presets when setDefaultAgent is not provided', () => {
    const db = freshDb();
    expect(() => runAgentBootstrap(makeRunner(db), { systemPrompt: DEFAULT_SYSTEM_PROMPT })).not.toThrow();
    expect(agentRows(db)).toHaveLength(4);
    db.close();
  });
});

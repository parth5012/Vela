import { DatabaseSync } from 'node:sqlite';
import { threads, agents } from '../db/schema';
import { applyMigrations, migrationKeys, migrationTags } from './helpers/sqliteMigrations';

const AGENT_COLUMNS = [
  'id',
  'name',
  'description',
  'icon',
  'system_prompt',
  'compact_prompt_instructions',
  'model',
  'is_preset',
  'created_at',
  'updated_at',
];

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function migrationSql(tag: string): string {
  const idx = migrationTags().indexOf(tag);
  const key = `m${String(idx).padStart(4, '0')}`;
  return (require('../db/migrations/migrations').default.migrations[key] as string) || '';
}

function runDrizzleMigrations(db: DatabaseSync, upToIdx?: number): void {
  const journal = require('../db/migrations/meta/_journal.json') as { entries: { idx: number; when: number }[] };
  const bundle = require('../db/migrations/migrations').default.migrations as Record<string, string>;
  db.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
  );
  const lastRows = db
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .all() as { created_at: number }[];
  const lastDbMigration = lastRows[0];
  for (const entry of journal.entries) {
    if (upToIdx !== undefined && entry.idx > upToIdx) continue;
    if (lastDbMigration && !(Number(lastDbMigration.created_at) < entry.when)) continue;
    const sql = bundle[`m${String(entry.idx).padStart(4, '0')}`];
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('', entry.when);
  }
}

describe('agents table schema (#356)', () => {
  it('defines exactly the columns from the ticket', () => {
    expect(Object.keys(agents).sort()).toEqual([...AGENT_COLUMNS].sort());
  });

  it('has no temperature or tool_names column', () => {
    expect((agents as any).temperature).toBeUndefined();
    expect((agents as any).tool_names).toBeUndefined();
  });

  it('enforces NOT NULL on the seed-critical columns', () => {
    expect(agents.id.primary).toBe(true);
    expect(agents.id.notNull).toBe(true);
    expect(agents.name.notNull).toBe(true);
    expect(agents.system_prompt.notNull).toBe(true);
    expect(agents.is_preset.notNull).toBe(true);
    expect(agents.description.notNull).toBe(false);
    expect(agents.icon.notNull).toBe(false);
    expect(agents.model.notNull).toBe(false);
    expect(agents.compact_prompt_instructions.notNull).toBe(false);
  });

  it('defaults is_preset to false', () => {
    expect(agents.is_preset.default).toBe(false);
  });

  it('renames threads.persona to threads.agent', () => {
    expect(threads.agent).toBeDefined();
    expect((threads as any).persona).toBeUndefined();
  });
});

describe('migration 0007 (#356)', () => {
  it('is registered as the last migration with a matching tag', () => {
    const keys = migrationKeys();
    expect(keys[keys.length - 1]).toBe('m0007');
    expect(migrationTags()[migrationTags().length - 1]).toMatch(/^0007_/);
  });

  it('creates the agents table', () => {
    const sql = migrationSql(migrationTags()[migrationTags().length - 1]);
    expect(sql).toContain('CREATE TABLE `agents`');
    for (const column of AGENT_COLUMNS) {
      expect(sql).toContain(`\`${column}\``);
    }
    expect(sql).not.toContain('temperature');
    expect(sql).not.toContain('tool_names');
  });

  it('renames the threads column instead of dropping and re-adding it', () => {
    const sql = migrationSql(migrationTags()[migrationTags().length - 1]);
    expect(sql).toMatch(/ALTER TABLE [`"]?threads[`"]? RENAME COLUMN [`"]?persona[`"]? TO [`"]?agent[`"]?/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  it('keeps journal timestamps strictly increasing so the upgrade DB actually runs it', () => {
    const journal = require('../db/migrations/meta/_journal.json') as { entries: { when: number }[] };
    const whenList = journal.entries.map((e) => e.when);
    for (let i = 1; i < whenList.length; i++) {
      expect(whenList[i]).toBeGreaterThan(whenList[i - 1]);
    }
  });

  it('does not touch the historical migrations that shipped with `persona`', () => {
    const sql = migrationSql('0000_gorgeous_saracen');
    expect(sql).toContain('`persona` text');
  });
});

describe('migration 0007 against a real SQLite database (#356)', () => {
  it('applies cleanly on a fresh database', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    applyMigrations(db);

    expect(tableColumns(db, 'agents')).toEqual(AGENT_COLUMNS);
    const threadColumns = tableColumns(db, 'threads');
    expect(threadColumns).toContain('agent');
    expect(threadColumns).not.toContain('persona');
    db.close();
  });

  it('preserves existing thread and message rows when upgrading a DB that already has threads', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    applyMigrations(db, { to: 6 });

    db.prepare(
      'INSERT INTO threads (id, title, persona, updated_at, is_pinned) VALUES (?, ?, ?, ?, ?)'
    ).run('t1', 'Kept thread', 'teacher', '2026-01-01T00:00:00.000Z', 1);
    db.prepare(
      'INSERT INTO threads (id, title, persona, updated_at, is_pinned) VALUES (?, ?, ?, ?, ?)'
    ).run('t2', 'Second thread', 'analyst', '2026-01-02T00:00:00.000Z', 0);
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('m1', 't1', 'user', 'hello', 'local', 1);

    applyMigrations(db, { from: 7 });

    const rows = db
      .prepare('SELECT id, title, agent, updated_at, is_pinned FROM threads ORDER BY id')
      .all() as { id: string; title: string; agent: string; updated_at: string; is_pinned: number }[];
    expect(rows).toEqual([
      { id: 't1', title: 'Kept thread', agent: 'teacher', updated_at: '2026-01-01T00:00:00.000Z', is_pinned: 1 },
      { id: 't2', title: 'Second thread', agent: 'analyst', updated_at: '2026-01-02T00:00:00.000Z', is_pinned: 0 },
    ]);
    expect(tableColumns(db, 'threads')).toContain('agent');
    expect(tableColumns(db, 'threads')).not.toContain('persona');

    const messages = db.prepare('SELECT id, conversation_id FROM messages').all();
    expect(messages).toHaveLength(1);
    db.close();
  });

  it('leaves the agents table empty so seeding can populate it', () => {
    const db = new DatabaseSync(':memory:');
    applyMigrations(db, { to: 6 });
    applyMigrations(db, { from: 7 });
    const rows = db.prepare('SELECT * FROM agents').all();
    expect(rows).toHaveLength(0);
    db.close();
  });

  it('passes the real drizzle migrator gate on a DB already migrated to 0006', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    runDrizzleMigrations(db, 6);

    db.prepare(
      'INSERT INTO threads (id, title, persona, updated_at, is_pinned) VALUES (?, ?, ?, ?, ?)'
    ).run('t1', 'Shipped thread', 'teacher', '2026-01-01T00:00:00.000Z', 0);

    runDrizzleMigrations(db);

    expect(tableColumns(db, 'agents')).toEqual(AGENT_COLUMNS);
    expect(tableColumns(db, 'threads')).not.toContain('persona');
    const row = db.prepare('SELECT agent FROM threads WHERE id = ?').get('t1') as { agent: string };
    expect(row.agent).toBe('teacher');

    runDrizzleMigrations(db);
    expect(db.prepare('SELECT * FROM agents').all()).toHaveLength(0);
    db.close();
  });
});

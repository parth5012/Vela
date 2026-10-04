import { DatabaseSync } from 'node:sqlite';
import { tasks, TaskEntity } from '../db/schema';
import { applyMigrations, migrationKeys, migrationTags } from './helpers/sqliteMigrations';
import { resolveTaskMode } from '../utils/taskRunner';
import { useConfigStore } from '../store/useConfigStore';

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('tasks table schema & connection_mode migration (#362)', () => {
  it('defines connection_mode in drizzle schema', () => {
    expect(tasks.connection_mode).toBeDefined();
    expect(tasks.connection_mode.notNull).toBe(false);
  });

  it('includes 0008_task_connection_mode in migration tags and keys', () => {
    expect(migrationTags()).toContain('0008_task_connection_mode');
    expect(migrationKeys()).toContain('m0008');
  });

  it('migrates an existing database to post-0008 without backfilling NULL rows', () => {
    const memDb = new DatabaseSync(':memory:');

    // Apply migrations up to 0007 (before connection_mode column)
    const idx0007 = migrationTags().indexOf('0007_agents_and_thread_agent');
    applyMigrations(memDb, { to: idx0007 });

    const colsBefore = tableColumns(memDb, 'tasks');
    expect(colsBefore).not.toContain('connection_mode');

    // Insert a task before migration 0008
    memDb.prepare(`
      INSERT INTO tasks (id, title, recurrence_rule, task_prompt, status, created_at, updated_at)
      VALUES ('legacy-task', 'Legacy Task', '24h', 'Legacy prompt', 'active', 1000, 1000)
    `).run();

    // Now apply migration 0008
    const idx0008 = migrationTags().indexOf('0008_task_connection_mode');
    applyMigrations(memDb, { from: idx0008, to: idx0008 });

    const colsAfter = tableColumns(memDb, 'tasks');
    expect(colsAfter).toContain('connection_mode');

    // Verify existing row was not backfilled (remains NULL)
    const legacyRow = memDb.prepare('SELECT * FROM tasks WHERE id = ?').get('legacy-task') as any;
    expect(legacyRow.connection_mode).toBeNull();

    // Verify new tasks can insert all allowed modes and NULL
    memDb.prepare(`
      INSERT INTO tasks (id, title, recurrence_rule, task_prompt, connection_mode, status, created_at, updated_at)
      VALUES ('task-local', 'Local Task', '24h', 'prompt', 'local', 'active', 2000, 2000)
    `).run();
    memDb.prepare(`
      INSERT INTO tasks (id, title, recurrence_rule, task_prompt, connection_mode, status, created_at, updated_at)
      VALUES ('task-cloud', 'Cloud Task', '24h', 'prompt', 'cloud', 'active', 3000, 3000)
    `).run();
    memDb.prepare(`
      INSERT INTO tasks (id, title, recurrence_rule, task_prompt, connection_mode, status, created_at, updated_at)
      VALUES ('task-server', 'Server Task', '24h', 'prompt', 'server', 'active', 4000, 4000)
    `).run();

    const localRow = memDb.prepare('SELECT connection_mode FROM tasks WHERE id = ?').get('task-local') as any;
    expect(localRow.connection_mode).toBe('local');

    const cloudRow = memDb.prepare('SELECT connection_mode FROM tasks WHERE id = ?').get('task-cloud') as any;
    expect(cloudRow.connection_mode).toBe('cloud');

    const serverRow = memDb.prepare('SELECT connection_mode FROM tasks WHERE id = ?').get('task-server') as any;
    expect(serverRow.connection_mode).toBe('server');

    memDb.close();
  });

  it('resolves task connection_mode using TaskEntity on resolveTaskMode', () => {
    useConfigStore.setState({ connectionMode: 'server' });

    const taskWithLocal: TaskEntity = {
      id: 't-1',
      title: 'Task 1',
      description: null,
      recurrence_rule: '24h',
      task_prompt: 'prompt',
      linked_agent: null,
      connection_mode: 'local',
      status: 'active',
      last_run: null,
      next_run: null,
      created_at: Date.now(),
    };
    expect(resolveTaskMode(taskWithLocal)).toBe('local');

    const taskWithNull: TaskEntity = {
      ...taskWithLocal,
      connection_mode: null,
    };
    useConfigStore.setState({ connectionMode: 'cloud' });
    expect(resolveTaskMode(taskWithNull)).toBe('cloud');

    useConfigStore.setState({ connectionMode: 'server' });
    expect(resolveTaskMode(taskWithNull)).toBe('server');
  });
});

import { eq } from 'drizzle-orm';
import { tasks, taskExecutions, taskStepExecutions } from '../db/schema';
import {
  isE2E,
  initE2EDatabase,
  resetE2EDatabase,
  getE2EDb,
  getE2ERawDb,
  getSqlModule,
} from '../db/e2eAdapter';

describe('E2E SQLite Adapter', () => {
  it('initializes raw sql.js module and executes in-memory SQLite statements', async () => {
    const SQL = await getSqlModule();
    expect(SQL).toBeDefined();

    const rawDb = new SQL.Database();
    rawDb.run('CREATE TABLE test_table (id text, name text);');
    rawDb.run('INSERT INTO test_table VALUES (?, ?);', ['1', 'Vela Test']);
    const rows = rawDb.exec('SELECT * FROM test_table;');
    expect(rows[0].columns).toEqual(['id', 'name']);
    expect(rows[0].values[0]).toEqual(['1', 'Vela Test']);
    rawDb.close();
  });

  it('proves the adapter flag is inactive in default non-E2E environments', () => {
    // Under regular test/prod runs without EXPO_PUBLIC_E2E=1, isE2E is false
    if (process.env.EXPO_PUBLIC_E2E !== '1') {
      expect(isE2E).toBe(false);
      expect(getE2EDb()).toBeNull();
    }
  });

  describe('in-memory SQLite engine under E2E activation', () => {
    it('initializes sql.js, applies migrations, and supports full CRUD on tasks', async () => {
      const db = await initE2EDatabase();
      expect(db).toBeDefined();
      expect(getE2EDb()).toBe(db);
      expect(getE2ERawDb()).toBeDefined();

      const taskId = 'e2e-task-crud-1';
      const now = Date.now();

      // 1. Create (Insert)
      await db.insert(tasks).values({
        id: taskId,
        title: 'Morning Briefing Task',
        description: 'Auto-generated briefing',
        status: 'active',
        recurrence_rule: '0 8 * * *',
        linked_agent: null,
        task_prompt: 'Summarize news and calendar',
        connection_mode: 'server',
        created_at: now,
      });

      // 2. Read (Query)
      const foundTask = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
      });
      expect(foundTask).toBeDefined();
      expect(foundTask?.title).toBe('Morning Briefing Task');
      expect(foundTask?.status).toBe('active');

      // 3. Update
      await db
        .update(tasks)
        .set({ title: 'Updated Morning Briefing', status: 'paused' })
        .where(eq(tasks.id, taskId));

      const updatedTask = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
      });
      expect(updatedTask?.title).toBe('Updated Morning Briefing');
      expect(updatedTask?.status).toBe('paused');

      // 4. Create child execution & step execution
      const execId = 'exec-1';
      await db.insert(taskExecutions).values({
        id: execId,
        task_id: taskId,
        status: 'running',
        started_at: now,
      });

      const stepId = 'step-1';
      await db.insert(taskStepExecutions).values({
        id: stepId,
        execution_id: execId,
        step_index: 0,
        output: 'Fetch calendar events',
        status: 'completed',
        started_at: now,
        completed_at: now + 500,
      });

      const foundStep = await db.query.taskStepExecutions.findFirst({
        where: eq(taskStepExecutions.id, stepId),
      });
      expect(foundStep?.output).toBe('Fetch calendar events');

      // 5. Delete
      await db.delete(tasks).where(eq(tasks.id, taskId));
      const remainingTasks = await db.select().from(tasks).where(eq(tasks.id, taskId));
      expect(remainingTasks).toHaveLength(0);
    });

    it('resetE2EDatabase clears all seeded data and returns a fresh migrated database', async () => {
      const db = await initE2EDatabase();
      const now = Date.now();

      // Seed a task row
      await db.insert(tasks).values({
        id: 'seed-before-reset',
        title: 'Transient Task',
        status: 'active',
        recurrence_rule: '0 12 * * *',
        task_prompt: 'Transient prompt',
        created_at: now,
      });

      const beforeCount = await db.select().from(tasks);
      expect(beforeCount.length).toBeGreaterThanOrEqual(1);

      // Reset
      await resetE2EDatabase();

      // Verify db is fresh and empty
      const freshDb = getE2EDb();
      expect(freshDb).toBeDefined();
      const afterCount = await freshDb!.select().from(tasks);
      expect(afterCount).toHaveLength(0);
    });
  });
});

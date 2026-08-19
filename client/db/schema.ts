import sqliteTable, text, integer 'drizzle-orm/sqlite-core';
export const threads sqliteTable('threads', {
  id:text('id').primaryKey(),
  title:text('title').notNull(),
  persona:text('persona').default('personal assistant').notNull(),
  updated_at:text('updated_at').notNull(),
  is_pinned:integer('is_pinned', { mode: 'boolean' }).default(false).notNull(),
});
export const messages sqliteTable('messages', {
  id:text('id').primaryKey(),
  conversation_id:text('conversation_id')
    .notNull()
    .references(() threads.id, { onDelete: 'cascade' }),
  role:text('role').$type<'user' 'assistant'>().notNull(),
  content:text('content').notNull(),
  provider:text('provider').notNull(),
  created_at:integer('created_at').notNull(),
  pending:integer('pending', { mode: 'boolean' }).default(false).notNull(),
  server_id:text('server_id'),
});
export const operationLog sqliteTable('operation_log', {
  id:text('id').primaryKey(),
  type:text('type').notNull(),
  conversation_id:text('conversation_id').notNull(),
  payload:text('payload').notNull(),
  created_at:integer('created_at').notNull(),
});
export type ThreadEntity = typeof threads.$inferSelect;
export type InsertThreadEntity = typeof threads.$inferInsert;
export type MessageEntity = typeof messages.$inferSelect;
export type InsertMessageEntity = typeof messages.$inferInsert;
export type OperationLogEntity = typeof operationLog.$inferSelect;
export type InsertOperationLogEntity = typeof operationLog.$inferInsert;

export const tasks sqliteTable('tasks', {
  id:text('id').primaryKey(),
  title:text('title').notNull(),
  description:text('description'),
  status:text('status').$type<'active' 'paused'>().default('active').notNull(),
  recurrence_rule:text('recurrence_rule').notNull(),
  linked_agent:text('linked_agent'),
  task_prompt:text('task_prompt').notNull(),
  last_run:integer('last_run'),
  next_run:integer('next_run'),
  created_at:integer('created_at').notNull(),
  updated_at:integer('updated_at').notNull(),
});
export const taskRuns sqliteTable('task_runs', {
  id:text('id').primaryKey(),
  task_id:text('task_id')
    .notNull()
    .references(() tasks.id, { onDelete: 'cascade' }),
  status:text('status').$type<'running' 'completed' 'failed'>().notNull(),
  started_at:integer('started_at').notNull(),
  completed_at:integer('completed_at'),
  output:text('output'),
});
export type TaskEntity = typeof tasks.$inferSelect;
export type InsertTaskEntity = typeof tasks.$inferInsert;
export type TaskRunEntity = typeof taskRuns.$inferSelect;
export type InsertTaskRunEntity = typeof taskRuns.$inferInsert;

export const taskExecutions sqliteTable('task_executions', {
  id:text('id').primaryKey(),
  task_id:text('task_id')
    .notNull()
    .references(() tasks.id, { onDelete: 'cascade' }),
  backend_run_id:text('backend_run_id'),
  status:text('status').$type<
    'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  >().default('pending').notNull(),
  current_step_index:integer('current_step_index').notNull().default(0),
  started_at:integer('started_at').notNull(),
  completed_at:integer('completed_at'),
  cancelled:integer('cancelled', { mode: 'boolean' }).notNull().default(false),
  interrupted:integer('interrupted', { mode: 'boolean' }).notNull().default(false),
  awaiting_approval:integer('awaiting_approval', { mode: 'boolean' }).notNull().default(false),
  task_plan:text('task_plan'),
  last_action:text('last_action'),
});
export const taskStepExecutions sqliteTable('task_step_executions', {
  id:text('id').primaryKey(),
  execution_id:text('execution_id')
    .notNull()
    .references(() taskExecutions.id, { onDelete: 'cascade' }),
  step_index:integer('step_index').notNull(),
  status:text('status').$type<'pending' | 'running' | 'completed' | 'failed'>().default('pending').notNull(),
  started_at:integer('started_at').notNull(),
  completed_at:integer('completed_at'),
  output:text('output'),
});
export type TaskExecutionEntity = typeof taskExecutions.$inferSelect;
export type InsertTaskExecutionEntity = typeof taskExecutions.$inferInsert;
export type TaskStepExecutionEntity = typeof taskStepExecutions.$inferSelect;
export type InsertTaskStepExecutionEntity = typeof taskStepExecutions.$inferInsert;

export const taskExecutions sqliteTable('task_executions', {
  id:text('id').primaryKey(),
  task_id:text('task_id')
    .notNull()
    .references(() tasks.id, onDelete: 'cascade' }),
  backend_run_id:text('backend_run_id'),
  status:text('status').$type<'pending' 'running' 'completed' 'cancelled' 'interrupted'>().default('pending').notNull(),
  current_step_index:integer('current_step_index').notNull().default(0),
  started_at:integer('started_at').notNull(),
  completed_at:integer('completed_at'),
  cancelled:integer('cancelled', { mode: 'boolean' }).notNull().default(false),
  interrupted:integer('interrupted', { mode: 'boolean' }).notNull().default(false),
  awaiting_approval:integer('awaiting_approval', { mode: 'boolean' }).notNull().default(false),
  task_plan:text('task_plan'),
  last_action:text('last_action'),
});

export const taskStepExecutions sqliteTable('task_step_executions', {
  id:text('id').primaryKey(),
  execution_id:text('execution_id')
    .notNull()
    .references(() taskExecutions.id, onDelete: 'cascade' }),
  step_index:integer('step_index').notNull(),
  status:text('status').$type<'pending' 'running' 'completed' 'failed'>().default('pending').notNull(),
  started_at:integer('started_at').notNull(),
  completed_at:integer('completed_at'),
  output:text('output'),
});

export type TaskExecutionEntity typeof taskExecutions.$inferSelect;
export type InsertTaskExecutionEntity typeof taskExecutions.$inferInsert;

export type TaskStepExecutionEntity typeof taskStepExecutions.$inferSelect;
export type InsertTaskStepExecutionEntity typeof taskStepExecutions.$inferInsert;

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  persona: text('persona').default('personal assistant').notNull(),
  updated_at: text('updated_at').notNull(),
  is_pinned: integer('is_pinned', { mode: 'boolean' }).default(false).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversation_id: text('conversation_id')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  content: text('content').notNull(),
  provider: text('provider').notNull(),
  created_at: integer('created_at').notNull(), // Epoch timestamp in ms or unix timestamp
});

export const operationLog = sqliteTable('operation_log', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // e.g. "message"
  conversation_id: text('conversation_id').notNull(),
  payload: text('payload').notNull(), // JSON string or text representation
  created_at: integer('created_at').notNull(),
});

export type ThreadEntity = typeof threads.$inferSelect;
export type InsertThreadEntity = typeof threads.$inferInsert;

export type MessageEntity = typeof messages.$inferSelect;
export type InsertMessageEntity = typeof messages.$inferInsert;

export type OperationLogEntity = typeof operationLog.$inferSelect;
export type InsertOperationLogEntity = typeof operationLog.$inferInsert;

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').$type<'active' | 'paused'>().default('active').notNull(),
  recurrence_rule: text('recurrence_rule').notNull(),
  linked_agent: text('linked_agent'),
  task_prompt: text('task_prompt').notNull(),
  last_run: integer('last_run'),
  next_run: integer('next_run'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const taskRuns = sqliteTable('task_runs', {
  id: text('id').primaryKey(),
  task_id: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  status: text('status').$type<'running' | 'completed' | 'failed'>().notNull(),
  started_at: integer('started_at').notNull(),
  completed_at: integer('completed_at'),
  output: text('output'),
});

export type TaskEntity = typeof tasks.$inferSelect;
export type InsertTaskEntity = typeof tasks.$inferInsert;

export type TaskRunEntity = typeof taskRuns.$inferSelect;
export type InsertTaskRunEntity = typeof taskRuns.$inferInsert;

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

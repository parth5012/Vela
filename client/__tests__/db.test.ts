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

import { threads, messages, operationLog, tasks, taskRuns } from '../db/schema';
import db, { initializeDatabase } from '../db/client';

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
    expect(threads.persona).toBeDefined();
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

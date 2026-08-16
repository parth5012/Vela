jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    getAllAsync: jest.fn(),
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

import { expoDb } from '../db/client';
import { searchMessages } from '../db/messageSearch';

describe('messageSearch (FTS5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return empty array when database client is unavailable', async () => {
    // Temporarily simulate missing db by making getAllAsync absent.
    const original = (expoDb as any).getAllAsync;
    delete (expoDb as any).getAllAsync;
    const result = await searchMessages('hello');
    (expoDb as any).getAllAsync = original;
    expect(result).toEqual([]);
  });

  it('should return empty array for empty/whitespace query without hitting db', async () => {
    const result = await searchMessages('   ');
    expect(result).toEqual([]);
    expect(expoDb.getAllAsync).not.toHaveBeenCalled();
  });

  it('should query messages_fts with MATCH and join to messages', async () => {
    (expoDb.getAllAsync as jest.Mock).mockResolvedValueOnce([
      { id: 'msg-1', conversation_id: 'conv-1', content: 'hello world', created_at: 123 },
    ]);

    const result = await searchMessages('hello');

    expect(expoDb.getAllAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = (expoDb.getAllAsync as jest.Mock).mock.calls[0];
    expect(sql).toContain('FROM messages_fts');
    expect(sql).toContain('JOIN messages');
    expect(sql).toContain('MATCH ?');
    expect(params).toEqual(['"hello"']);
    expect(result).toEqual([
      { id: 'msg-1', conversation_id: 'conv-1', content: 'hello world', created_at: 123 },
    ]);
  });

  it('should escape double quotes inside the query term', async () => {
    (expoDb.getAllAsync as jest.Mock).mockResolvedValueOnce([]);

    await searchMessages('say "hi"');

    const params = (expoDb.getAllAsync as jest.Mock).mock.calls[0][1];
    expect(params).toEqual(['"say ""hi"""']);
  });

  it('should return empty array when the query throws', async () => {
    (expoDb.getAllAsync as jest.Mock).mockRejectedValueOnce(new Error('FTS failure'));

    const result = await searchMessages('broken');
    expect(result).toEqual([]);
  });
});

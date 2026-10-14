import {
  saveMemory,
  deleteMemory,
  listMemories,
  clearInMemoryMemories,
} from '../db/memoryRepository';

describe('memoryRepository (local SQLite / standalone memory store)', () => {
  beforeEach(() => {
    clearInMemoryMemories();
  });

  it('saves new facts into memory', async () => {
    const res = await saveMemory('conv-1', 'User prefers dark mode');
    expect(res).toContain("Successfully saved new memory: 'User prefers dark mode'");

    const all = await listMemories('conv-1');
    expect(all.length).toBe(1);
    expect(all[0].fact).toBe('User prefers dark mode');
    expect(all[0].conversation_id).toBe('conv-1');
  });

  it('rejects empty fact saving and deletion', async () => {
    const saveRes = await saveMemory('conv-1', '   ');
    expect(saveRes).toContain('fact cannot be empty');

    const delRes = await deleteMemory('conv-1', '');
    expect(delRes).toContain('fact cannot be empty');
  });

  it('detects and skips duplicate memory saving', async () => {
    await saveMemory('conv-1', 'User lives in Berlin');
    const dupRes = await saveMemory('conv-1', 'user lives in berlin');

    expect(dupRes).toContain('duplicate of existing record');
    const all = await listMemories('conv-1');
    expect(all.length).toBe(1);
  });

  it('deletes an existing memory by matching fact text', async () => {
    await saveMemory('conv-1', 'User lives in Berlin');
    await saveMemory('conv-1', 'User favorite language is TypeScript');

    const delRes = await deleteMemory('conv-1', 'TypeScript');
    expect(delRes).toContain("Successfully deleted memory: 'User favorite language is TypeScript'");

    const all = await listMemories('conv-1');
    expect(all.length).toBe(1);
    expect(all[0].fact).toBe('User lives in Berlin');
  });

  it('returns not found message when trying to delete non-existent fact', async () => {
    await saveMemory('conv-1', 'User likes tea');
    const delRes = await deleteMemory('conv-1', 'User likes coffee');

    expect(delRes).toContain("No matching memory found for 'User likes coffee'");
  });
});

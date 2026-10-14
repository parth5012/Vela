import { db, expoDb } from './client';
import { memories, MemoryEntity } from './schema';
import { eq } from 'drizzle-orm';

// In-memory fallback for test environments where db is mock/null
const inMemoryStore: MemoryEntity[] = [];

export function isMemoryDbAvailable(): boolean {
  return !!db;
}

export function ensureMemoriesTable(): void {
  if (expoDb && typeof expoDb.execSync === 'function') {
    try {
      expoDb.execSync(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY NOT NULL,
          conversation_id TEXT NOT NULL,
          fact TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    } catch {
      // Table may already exist or running in mock environment
    }
  }
}

export async function saveMemory(conversationId: string, fact: string): Promise<string> {
  const cleanFact = fact?.trim();
  if (!cleanFact) {
    return 'Failed to save memory: fact cannot be empty.';
  }
  const convId = conversationId || 'default';

  if (db) {
    try {
      ensureMemoriesTable();
      const existing = await db
        .select()
        .from(memories)
        .where(eq(memories.conversation_id, convId));

      const duplicate = existing.find(
        (m: MemoryEntity) => m.fact.trim().toLowerCase() === cleanFact.toLowerCase()
      );
      if (duplicate) {
        return `Memory not modified (duplicate of existing record: '${duplicate.fact}')`;
      }

      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.insert(memories).values({
        id,
        conversation_id: convId,
        fact: cleanFact,
        created_at: Date.now(),
      });
      return `Successfully saved new memory: '${cleanFact}'`;
    } catch (err: any) {
      // Fall through to memory fallback on DB error in mock/unsupported environments
    }
  }

  // In-memory fallback
  const duplicate = inMemoryStore.find(
    (m) => m.conversation_id === convId && m.fact.trim().toLowerCase() === cleanFact.toLowerCase()
  );
  if (duplicate) {
    return `Memory not modified (duplicate of existing record: '${duplicate.fact}')`;
  }

  const newMem: MemoryEntity = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversation_id: convId,
    fact: cleanFact,
    created_at: Date.now(),
  };
  inMemoryStore.push(newMem);
  return `Successfully saved new memory: '${cleanFact}'`;
}

export async function deleteMemory(conversationId: string, fact: string): Promise<string> {
  const cleanFact = fact?.trim();
  if (!cleanFact) {
    return 'Failed to delete memory: fact cannot be empty.';
  }
  const convId = conversationId || 'default';
  const targetLower = cleanFact.toLowerCase();

  if (db) {
    try {
      ensureMemoriesTable();
      const existing = await db
        .select()
        .from(memories)
        .where(eq(memories.conversation_id, convId));

      const match = existing.find(
        (m: MemoryEntity) =>
          m.fact.toLowerCase() === targetLower || m.fact.toLowerCase().includes(targetLower)
      );

      if (match) {
        await db.delete(memories).where(eq(memories.id, match.id));
        return `Successfully deleted memory: '${match.fact}'`;
      }
      return `No matching memory found for '${cleanFact}'`;
    } catch (err: any) {
      // Fall through to memory fallback on DB error
    }
  }

  // In-memory fallback
  const matchIndex = inMemoryStore.findIndex(
    (m) =>
      m.conversation_id === convId &&
      (m.fact.toLowerCase() === targetLower || m.fact.toLowerCase().includes(targetLower))
  );

  if (matchIndex !== -1) {
    const deleted = inMemoryStore.splice(matchIndex, 1)[0];
    return `Successfully deleted memory: '${deleted.fact}'`;
  }

  return `No matching memory found for '${cleanFact}'`;
}

export async function listMemories(conversationId?: string): Promise<MemoryEntity[]> {
  if (db) {
    try {
      ensureMemoriesTable();
      if (conversationId) {
        return await db
          .select()
          .from(memories)
          .where(eq(memories.conversation_id, conversationId));
      }
      return await db.select().from(memories);
    } catch {
      // Fall through to inMemoryStore
    }
  }

  if (conversationId) {
    return inMemoryStore.filter((m) => m.conversation_id === conversationId);
  }
  return [...inMemoryStore];
}

export function clearInMemoryMemories(): void {
  inMemoryStore.length = 0;
}

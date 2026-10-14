import { db, expoDb } from './client';
import { memories, MemoryEntity } from './schema';
import { eq, asc } from 'drizzle-orm';

// In-memory fallback for test environments where db is mock/null
const inMemoryStore: MemoryEntity[] = [];

let tableInitialized = false;

export function isMemoryDbAvailable(): boolean {
  return !!db;
}

export function ensureMemoriesTable(): void {
  if (tableInitialized) return;
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
      tableInitialized = true;
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
    } catch (err: unknown) {
      console.warn('[MemoryRepository] DB operation failed, falling back to in-memory store:', err);
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

      const exactMatch = existing.find(
        (m: MemoryEntity) => m.fact.trim().toLowerCase() === targetLower
      );
      if (exactMatch) {
        await db.delete(memories).where(eq(memories.id, exactMatch.id));
        return `Successfully deleted memory: '${exactMatch.fact}'`;
      }

      const partialMatches = existing.filter(
        (m: MemoryEntity) => m.fact.toLowerCase().includes(targetLower)
      );
      if (partialMatches.length === 1) {
        const match = partialMatches[0];
        await db.delete(memories).where(eq(memories.id, match.id));
        return `Successfully deleted memory: '${match.fact}'`;
      }
      if (partialMatches.length > 1) {
        const candidates = partialMatches.map((m: MemoryEntity) => `'${m.fact}'`).join(', ');
        return `Multiple matching memories found for '${cleanFact}': ${candidates}. Please specify exact text to delete.`;
      }
      return `No matching memory found for '${cleanFact}'`;
    } catch (err: unknown) {
      console.warn('[MemoryRepository] DB operation failed, falling back to in-memory store:', err);
    }
  }

  // In-memory fallback
  const exactIndex = inMemoryStore.findIndex(
    (m) => m.conversation_id === convId && m.fact.trim().toLowerCase() === targetLower
  );
  if (exactIndex !== -1) {
    const deleted = inMemoryStore.splice(exactIndex, 1)[0];
    return `Successfully deleted memory: '${deleted.fact}'`;
  }

  const partialIndices = inMemoryStore
    .map((m, idx) => ({ m, idx }))
    .filter(
      ({ m }) => m.conversation_id === convId && m.fact.toLowerCase().includes(targetLower)
    );

  if (partialIndices.length === 1) {
    const { idx, m } = partialIndices[0];
    inMemoryStore.splice(idx, 1);
    return `Successfully deleted memory: '${m.fact}'`;
  }

  if (partialIndices.length > 1) {
    const candidates = partialIndices.map(({ m }) => `'${m.fact}'`).join(', ');
    return `Multiple matching memories found for '${cleanFact}': ${candidates}. Please specify exact text to delete.`;
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
          .where(eq(memories.conversation_id, conversationId))
          .orderBy(asc(memories.created_at));
      }
      return await db.select().from(memories).orderBy(asc(memories.created_at));
    } catch (err: unknown) {
      console.warn('[MemoryRepository] DB operation failed, falling back to in-memory store:', err);
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

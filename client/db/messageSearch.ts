import { expoDb } from './client';

export interface MessageSearchResult {
  id: string;
  conversation_id: string;
  content: string;
  created_at: number;
}

// FTS5 MATCH phrase quoting: double quotes inside the user term must be
// escaped by doubling them so they cannot break out of the quoted phrase.
function escapeMatchTerm(term: string): string {
  return term.replace(/"/g, '""');
}

/**
 * Full-text search over locally persisted messages using the `messages_fts`
 * FTS5 virtual table (created in migration 0002, kept in sync by triggers on
 * `messages` insert/update/delete).
 *
 * Returns up to 50 matching messages ordered by relevance. Safe to call when
 * the database is unavailable (test / non-native environments) — returns [].
 */
export async function searchMessages(query: string): Promise<MessageSearchResult[]> {
  if (!expoDb || typeof expoDb.getAllAsync !== 'function') {
    console.warn('[MessageSearch] Database client not available. Returning empty results.');
    return [];
  }

  const term = (query || '').trim();
  if (!term) {
    return [];
  }

  const match = `"${escapeMatchTerm(term)}"`;
  try {
    const rows = await expoDb.getAllAsync(
      `SELECT m.id, m.conversation_id, m.content, m.created_at
       FROM messages_fts f
       JOIN messages m ON m.rowid = f.rowid
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT 50`,
      [match]
    );
    return rows as MessageSearchResult[];
  } catch (error) {
    console.error('[MessageSearch] Search failed:', error);
    return [];
  }
}

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
import {
  searchMessages,
  saveMessageVector,
  indexMessageVectors,
  cosineSimilarity,
  NEEDLE_PROBE_POOL_MODEL,
} from '../db/messageSearch';

type Row = Record<string, unknown>;

/**
 * Dispatches the two reads `searchMessages` performs by the table the SQL
 * touches: the FTS5 lexical query vs. the stored-vector candidate query.
 * Honours the query's own LIMIT (bound `?` or a literal) like SQLite would,
 * so a caller-supplied `options.limit` that never reaches the SQL is caught.
 */
function mockDb(rows: { fts?: Row[]; vectors?: Row[] }) {
  const limitFrom = (all: Row[], sql: string, bound: unknown): Row[] => {
    if (typeof bound === 'number') return all.slice(0, bound);
    const literal = /LIMIT\s+(\d+)/i.exec(sql);
    return literal ? all.slice(0, Number(literal[1])) : all;
  };
  const getAllAsync = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('messages_fts')) return limitFrom(rows.fts ?? [], sql, params[1]);
    if (sql.includes('message_vectors')) return limitFrom(rows.vectors ?? [], sql, params[0]);
    throw new Error(`unexpected query: ${sql}`);
  });
  (expoDb as any).getAllAsync = getAllAsync;
  return getAllAsync;
}

// Unit-norm vectors over a shared 3-axis frame; cosines against QUERY_VECTOR
// are exact: strong 0.8, paraphrase 0.95, noise 0.2, irrelevant 0.
const QUERY_VECTOR = [1, 0, 0];
const VECTORS: Record<string, number[]> = {
  'msg-strong': [0.8, 0.6, 0],
  'msg-paraphrase': [0.95, 0, 0.31224989991991997],
  'msg-noise': [0.2, 0, 0.9797958971132712],
  'msg-irrelevant': [0, 0, 1],
};

function row(id: string, content: string, rank?: number, createdAt = 1): Row {
  const r: Row = { id, conversation_id: 'conv-1', content, created_at: createdAt };
  if (rank !== undefined) r.rank = rank;
  return r;
}

function vectorRows(): Row[] {
  return Object.entries(VECTORS).map(([id, vector], i) => ({
    message_id: id,
    embedding: JSON.stringify(vector),
    conversation_id: 'conv-1',
    content: `content for ${id}`,
    created_at: 100 - i,
  }));
}

const ids = (results: { id: string }[]) => results.map((r) => r.id);

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
    expect(params).toEqual(['"hello"', 50]);
    expect(result).toEqual([
      { id: 'msg-1', conversation_id: 'conv-1', content: 'hello world', created_at: 123 },
    ]);
  });

  it('should escape double quotes inside the query term', async () => {
    (expoDb.getAllAsync as jest.Mock).mockResolvedValueOnce([]);

    await searchMessages('say "hi"');

    const params = (expoDb.getAllAsync as jest.Mock).mock.calls[0][1];
    expect(params).toEqual(['"say ""hi"""', 50]);
  });

  it('should return empty array when the query throws', async () => {
    (expoDb.getAllAsync as jest.Mock).mockRejectedValueOnce(new Error('FTS failure'));

    const result = await searchMessages('broken');
    expect(result).toEqual([]);
  });
});

describe('messageSearch hybrid ranking (#299)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const embed = async (text: string) => (text === 'needle query' ? QUERY_VECTOR : null);

  it('merges FTS5 hits with cosine similarity and ranks by the hybrid score', async () => {
    mockDb({
      fts: [
        row('msg-strong', 'strong lexical hit', -3.2),
        row('msg-noise', 'off-topic phrase hit', -0.8),
      ],
      vectors: vectorRows(),
    });

    const results = await searchMessages('needle query', { embed });

    // strong = 0.5*1 + 0.5*0.8, paraphrase = 0.5*0 + 0.5*0.95,
    // noise = 0.5*0 + 0.5*0.2, irrelevant = 0. Placeholder weights (#299).
    expect(ids(results)).toEqual([
      'msg-strong',
      'msg-paraphrase',
      'msg-noise',
      'msg-irrelevant',
    ]);
    // Internal `rank` column must not leak into the public result shape.
    expect(Object.keys(results[0]).sort()).toEqual([
      'content',
      'conversation_id',
      'created_at',
      'id',
    ]);
  });

  it('keeps messages without a stored vector in the results (lexical only)', async () => {
    mockDb({
      fts: [
        row('msg-strong', 'strong lexical hit', -3.2),
        row('msg-novec', 'lexically matched, never embedded', -1),
        row('msg-noise', 'off-topic phrase hit', -0.8),
      ],
      vectors: vectorRows(),
    });

    const results = await searchMessages('needle query', { embed });

    expect(ids(results)).toContain('msg-novec');
    expect(ids(results)[0]).toBe('msg-strong');
    expect(ids(results)).toHaveLength(5);
  });

  it('ranks FTS-only and vector-only channels without dropping either side', async () => {
    mockDb({
      fts: [row('msg-strong', 'strong lexical hit', -3.2)],
      vectors: vectorRows(),
    });

    const results = await searchMessages('needle query', { embed });

    // Vector-only paraphrase is promoted; FTS-only strong hit keeps top slot.
    expect(ids(results)[0]).toBe('msg-strong');
    expect(ids(results)).toContain('msg-paraphrase');
  });

  it('falls back to pure lexical results when embed returns null', async () => {
    const getAllAsync = mockDb({
      fts: [row('msg-strong', 'a', -3.2), row('msg-noise', 'b', -0.8)],
      vectors: vectorRows(),
    });

    const results = await searchMessages('needle query', { embed: async () => null });

    // FTS ORDER BY rank is preserved verbatim and the vector query is skipped.
    expect(ids(results)).toEqual(['msg-strong', 'msg-noise']);
    expect(getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('never throws when the embedder rejects; lexical results survive', async () => {
    mockDb({
      fts: [row('msg-strong', 'a', -3.2), row('msg-noise', 'b', -0.8)],
      vectors: vectorRows(),
    });

    const results = await searchMessages('needle query', {
      embed: async () => {
        throw new Error('engine not loaded');
      },
    });

    expect(ids(results)).toEqual(['msg-strong', 'msg-noise']);
  });

  it('never throws when the stored-vector query fails (e.g. migration not applied)', async () => {
    const getAllAsync = jest.fn(async (sql: string) => {
      if (sql.includes('messages_fts')) return [row('msg-strong', 'a', -3.2)];
      throw new Error('no such table: message_vectors');
    });
    (expoDb as any).getAllAsync = getAllAsync;

    const results = await searchMessages('needle query', { embed });

    expect(ids(results)).toEqual(['msg-strong']);
    expect(getAllAsync).toHaveBeenCalledTimes(2);
  });

  it('treats corrupt stored vectors as missing instead of failing the search', async () => {
    mockDb({
      fts: [row('msg-strong', 'a', -3.2)],
      vectors: [
        {
          message_id: 'msg-corrupt',
          embedding: 'not-json',
          conversation_id: 'conv-1',
          content: 'corrupt vector row',
          created_at: 1,
        },
        ...vectorRows(),
      ],
    });

    const results = await searchMessages('needle query', { embed });

    expect(ids(results)).toContain('msg-corrupt');
    expect(ids(results)).toContain('msg-paraphrase');
    expect(ids(results)[0]).toBe('msg-strong');
  });

  it('exposes an explicit lexical-only switch (embed: null)', async () => {
    const getAllAsync = mockDb({
      fts: [row('msg-strong', 'a', -3.2)],
      vectors: vectorRows(),
    });

    const results = await searchMessages('needle query', { embed: null });

    expect(ids(results)).toEqual(['msg-strong']);
    expect(getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('computes cosine similarity with zero-vector and length guards', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([NaN, 1], [1, 1]))).toBe(false);
  });

  it('scores mismatched dimensions as 0, never a partial dot product', () => {
    // Corrupt row / model change between indexing and query: a truncated
    // cosine over Math.min(length) would claim 1.0 for [1,0,0] vs [1,0].
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('ranks a wrong-dimension stored vector lexically, not by a partial cosine', async () => {
    mockDb({
      fts: [
        row('msg-strong', 'strong lexical hit', -3.2),
        row('msg-weak', 'weak phrase hit', -0.8),
      ],
      vectors: [
        // Same first two components as the query but a different dimension.
        { message_id: 'msg-weak', embedding: JSON.stringify([1, 0]), conversation_id: 'conv-1', content: 'wrong dim', created_at: 1000 },
        { message_id: 'msg-paraphrase', embedding: JSON.stringify(VECTORS['msg-paraphrase']), conversation_id: 'conv-1', content: 'right dim', created_at: 999 },
      ],
    });

    const results = await searchMessages('needle query', { embed });

    // msg-weak gets cosine 0 (dim mismatch) → 0.5*0 + 0.5*0 = 0, while the
    // correct-dimension paraphrase scores 0.5*0 + 0.5*0.95 = 0.475.
    expect(ids(results)).toEqual(['msg-strong', 'msg-paraphrase', 'msg-weak']);
  });

  it('honours options.limit above the default 50 for both channels', async () => {
    const ftsRows = Array.from({ length: 60 }, (_, i) => row(`lex-${i}`, `lexical ${i}`, -5 - i, i));
    const vectorRows = Array.from({ length: 60 }, (_, i) => ({
      message_id: `sem-${i}`,
      embedding: JSON.stringify(QUERY_VECTOR),
      conversation_id: 'conv-1',
      content: `semantic ${i}`,
      created_at: 1000 + i,
    }));
    const getAllAsync = mockDb({ fts: ftsRows, vectors: vectorRows });

    const results = await searchMessages('needle query', { embed, limit: 60 });

    const [, params] = getAllAsync.mock.calls[0];
    expect(params).toEqual(['"needle query"', 60]);
    // 60 lexical rows fetched (the old hardcoded `LIMIT 50` would stop at 50)
    // and the merge caps at the same number instead of 120.
    expect(results).toHaveLength(60);
    expect(ids(results)).toContain('lex-59');
    expect(new Set(ids(results)).size).toBe(60);
  });

  it('fills lexical and vector candidates up to the same caller limit', async () => {
    const ftsRows = Array.from({ length: 30 }, (_, i) => row(`lex-${i}`, `lexical ${i}`, -5 - i, i));
    const vectorRows = Array.from({ length: 90 }, (_, i) => ({
      message_id: `sem-${i}`,
      embedding: JSON.stringify(QUERY_VECTOR),
      conversation_id: 'conv-1',
      content: `semantic ${i}`,
      created_at: 1000 + i,
    }));
    mockDb({ fts: ftsRows, vectors: vectorRows });

    const results = await searchMessages('needle query', { embed, limit: 60 });

    expect(results).toHaveLength(60);
    expect(ids(results).some((id) => id.startsWith('lex-'))).toBe(true);
    expect(ids(results).some((id) => id.startsWith('sem-'))).toBe(true);
  });

  it('keeps the default limit of 50 when none is passed', async () => {
    const ftsRows = Array.from({ length: 60 }, (_, i) => row(`lex-${i}`, `lexical ${i}`, -5 - i, i));
    const getAllAsync = mockDb({ fts: ftsRows, vectors: [] });

    const results = await searchMessages('needle query', { embed: null });

    expect(getAllAsync.mock.calls[0][1]).toEqual(['"needle query"', 50]);
    expect(results).toHaveLength(50);
  });
});

describe('message vector storage (#299)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (expoDb as any).runAsync = jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
  });

  afterEach(() => {
    delete (expoDb as any).runAsync;
  });

  it('persists a vector as JSON with an explicit provenance label', async () => {
    const saved = await saveMessageVector('msg-1', [0.25, 0.5]);

    expect(saved).toBe(true);
    const [sql, params] = (expoDb as any).runAsync.mock.calls[0];
    expect(sql).toContain('INSERT INTO message_vectors');
    expect(sql).toContain('ON CONFLICT(message_id)');
    expect(params[0]).toBe('msg-1');
    expect(JSON.parse(params[1])).toEqual([0.25, 0.5]);
    expect(params[2]).toBe(NEEDLE_PROBE_POOL_MODEL);
  });

  it('rejects empty and non-finite vectors without touching the database', async () => {
    expect(await saveMessageVector('msg-1', [])).toBe(false);
    expect(await saveMessageVector('msg-1', [1, NaN])).toBe(false);
    expect(await saveMessageVector('msg-1', [Infinity])).toBe(false);
    expect(await saveMessageVector('', [1])).toBe(false);
    expect((expoDb as any).runAsync).not.toHaveBeenCalled();
  });

  it('returns false when the database client cannot write', async () => {
    delete (expoDb as any).runAsync;
    expect(await saveMessageVector('msg-1', [1])).toBe(false);
  });

  it('returns false when the write fails', async () => {
    (expoDb as any).runAsync = jest.fn().mockRejectedValue(new Error('disk full'));
    expect(await saveMessageVector('msg-1', [1])).toBe(false);
  });

  it('indexes only messages that have no stored vector yet', async () => {
    (expoDb as any).getAllAsync = jest.fn(async (sql: string) => {
      expect(sql).toContain('LEFT JOIN message_vectors');
      return [
        { id: 'msg-a', content: 'alpha' },
        { id: 'msg-b', content: 'beta' },
      ];
    });
    const embed = jest.fn(async (text: string) => (text === 'alpha' ? [1, 0] : null));

    const result = await indexMessageVectors({ embed });

    expect(result).toEqual({ indexed: 1, skipped: 1 });
    expect((expoDb as any).runAsync).toHaveBeenCalledTimes(1);
    expect((expoDb as any).runAsync.mock.calls[0][1][0]).toBe('msg-a');
  });

  it('counts embed failures as skipped without throwing', async () => {
    (expoDb as any).getAllAsync = jest.fn(async () => [{ id: 'msg-a', content: 'alpha' }]);
    const embed = jest.fn(async () => {
      throw new Error('engine not initialized');
    });

    await expect(indexMessageVectors({ embed })).resolves.toEqual({
      indexed: 0,
      skipped: 1,
    });
  });

  it('is a no-op without a database client', async () => {
    delete (expoDb as any).runAsync;
    const original = (expoDb as any).getAllAsync;
    delete (expoDb as any).getAllAsync;

    await expect(
      indexMessageVectors({ embed: async () => [1] })
    ).resolves.toEqual({ indexed: 0, skipped: 0 });
    (expoDb as any).getAllAsync = original;
  });
});

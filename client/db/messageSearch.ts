/**
 * Module: client/db/messageSearch
 * Intent: Hybrid lexical (FTS5) + semantic (needle embed) message search over SQLite.
 * Responsibilities: Owns MessageSearchResult/Options types, cosineSimilarity, searchMessages, saveMessageVector, indexMessageVectors.
 * Public API: MessageSearchResult, EmbedFn, MessageSearchOptions, NEEDLE_PROBE_POOL_MODEL, HYBRID_*_WEIGHT, cosineSimilarity, searchMessages, saveMessageVector, indexMessageVectors.
 * Invariants: Missing/failing embedder never drops lexical results; limit clamped [1,500]; FTS phrase quoting escapes embedded quotes.
 * Side Effects: Reads/writes expoDb (FTS + vectors); calls NeedleModule.embed when embedder omitted (native, device-only).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { expoDb } from './client';
import NeedleModule from '../modules/needle';

export interface MessageSearchResult {
  id: string;
  conversation_id: string;
  content: string;
  created_at: number;
}

/**
 * Query/message embedder seam (#299). Production uses `NeedleModule.embed`;
 * tests inject stand-in vectors because needle_embed cannot run outside a
 * device build.
 */
export type EmbedFn = (text: string) => Promise<number[] | null> | number[] | null;

export interface MessageSearchOptions {
  /**
   * Semantic channel embedder.
   *  - omitted → on-device needle embedder when available, otherwise FTS5-only
   *  - null    → force FTS5-only (lexical baseline, e.g. for the #299 gate)
   *  - fn      → caller-supplied embedder (tests / fixtures)
   * A missing, failing or returning-null embedder never drops lexical results.
   */
  embed?: EmbedFn | null;
  /**
   * Max results returned. Default 50 (the pre-existing FTS5 limit), clamped
   * to [1, 500] — the same value is bound into the FTS `LIMIT ?` and used as
   * the hybrid merge's final cap, so both channels agree.
   */
  limit?: number;
}

/** Provenance label stored with every vector: probe pool, not contrastive. */
export const NEEDLE_PROBE_POOL_MODEL = 'needle3-probe-pool';

/**
 * PLACEHOLDER — merge weights are NOT validated. They are a neutral starting
 * point until the #299 quality gate has been run on a device against the
 * shipped needle3.cact vectors (see messageEmbeddingGate.ts).
 */
export const HYBRID_LEXICAL_WEIGHT = 0.5;
export const HYBRID_SEMANTIC_WEIGHT = 0.5;

const SEARCH_LIMIT = 50;
/** PLACEHOLDER — recency-capped candidate scan for the cosine pass. */
const SEMANTIC_CANDIDATE_LIMIT = 500;

// FTS5 MATCH phrase quoting: double quotes inside the user term must be
// escaped by doubling them so they cannot break out of the quoted phrase.
function escapeMatchTerm(term: string): string {
  return term.replace(/"/g, '""');
}

function hasDb(): boolean {
  return !!expoDb && typeof expoDb.getAllAsync === 'function';
}

/**
 * Cosine similarity over two vectors. Never returns NaN: empty input, a
 * dimension mismatch, a zero-norm vector or a non-finite component all yield
 * 0 (treated as "no signal" by the merge, which then falls back to the
 * lexical contribution). A truncated dot product over `min(a,b)` would be
 * meaningless — a corrupt row or a model change between indexing and query
 * must score 0, not a partial similarity.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const length = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA <= 0 || normB <= 0) return 0;
  const similarity = dot / Math.sqrt(normA * normB);
  if (!Number.isFinite(similarity)) return 0;
  return Math.max(-1, Math.min(1, similarity));
}

function parseVector(json: unknown): number[] | null {
  if (typeof json !== 'string') return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}

function toResult(row: Record<string, unknown>): MessageSearchResult {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    content: String(row.content),
    created_at: Number(row.created_at),
  };
}

/**
 * Default semantic channel: the on-device needle embedder. Returns null when
 * the native module is absent (Jest/web) or the engine is not initialized —
 * needle_embed has no mock, so we degrade instead of inventing vectors.
 */
function defaultEmbed(text: string): Promise<number[] | null> | number[] | null {
  try {
    if (!NeedleModule.isAvailable()) return null;
    if (typeof (NeedleModule as { embed?: unknown }).embed !== 'function') return null;
    return NeedleModule.embed(text);
  } catch {
    return null;
  }
}

function resolveEmbedder(options: MessageSearchOptions): EmbedFn | null {
  if (options.embed === null) return null;
  if (typeof options.embed === 'function') return options.embed;
  return defaultEmbed;
}

/**
 * Min-max normalisation of FTS5 `rank` (bm25, more negative = better) into
 * [0, 1] so the lexical channel can be scored alongside cosine similarity.
 * Rows without a usable rank (mocked DBs) all normalise to 1.
 */
function normalizeLexicalRanks(rows: Record<string, unknown>[]): number[] {
  const ranks = rows.map((row) => Number(row.rank));
  if (ranks.length === 0 || !ranks.every((rank) => Number.isFinite(rank))) {
    return rows.map(() => 1);
  }
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  if (max === min) return rows.map(() => 1);
  return ranks.map((rank) => (max - rank) / (max - min));
}

interface MergeCandidate {
  result: MessageSearchResult;
  score: number;
  ftsPosition: number;
  createdAt: number;
}

/**
 * Merges the FTS5 candidate set with the cosine-ranked stored-vector set.
 * PLACEHOLDER scoring: score = w_lex * normalised bm25 + w_sem * cosine, with
 * a missing channel contributing 0 rather than excluding the message.
 * Never throws; on any surprise the caller falls back to lexical-only.
 */
function mergeHybrid(
  ftsRows: Record<string, unknown>[],
  vectorRows: Record<string, unknown>[],
  queryVector: number[],
  limit: number
): MessageSearchResult[] {
  const vectorsById = new Map<string, number[]>();
  for (const row of vectorRows) {
    const vector = parseVector(row.embedding);
    if (vector) vectorsById.set(String(row.message_id), vector);
  }

  const lexicalScores = normalizeLexicalRanks(ftsRows);
  const candidates = new Map<string, MergeCandidate>();

  ftsRows.forEach((row, index) => {
    const result = toResult(row);
    const stored = vectorsById.get(result.id);
    const similarity = stored ? cosineSimilarity(queryVector, stored) : 0;
    candidates.set(result.id, {
      result,
      score: HYBRID_LEXICAL_WEIGHT * lexicalScores[index] + HYBRID_SEMANTIC_WEIGHT * similarity,
      ftsPosition: index,
      createdAt: Number.isFinite(result.created_at) ? result.created_at : 0,
    });
  });

  for (const row of vectorRows) {
    const id = String(row.message_id);
    if (candidates.has(id)) continue;
    const stored = vectorsById.get(id);
    const similarity = stored ? cosineSimilarity(queryVector, stored) : 0;
    candidates.set(id, {
      result: toResult({ ...row, id }),
      score: HYBRID_SEMANTIC_WEIGHT * similarity,
      ftsPosition: Number.POSITIVE_INFINITY,
      createdAt: Number(row.created_at) || 0,
    });
  }

  return Array.from(candidates.values())
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.ftsPosition - b.ftsPosition ||
        b.createdAt - a.createdAt
    )
    .slice(0, limit)
    .map((candidate) => candidate.result);
}

/**
 * Meaning-aware search over locally persisted messages (#299).
 *
 * Channel 1 — FTS5 lexical: unchanged `messages_fts` phrase query, results
 * ordered by bm25 rank.
 * Channel 2 — semantic: cosine similarity between the query vector and the
 * per-message vectors in `message_vectors`, merged with the lexical results.
 *
 * Degradation contract (all paths keep lexical results and never throw):
 *  - no embedder / embed returns null / embed throws → FTS5-only
 *  - `message_vectors` unreadable (migration not applied yet) → FTS5-only
 *  - a message without a stored vector → ranked by its lexical score alone
 *  - a corrupt stored vector → treated as missing (cosine 0)
 *
 * Safe to call when the database is unavailable (test / non-native
 * environments) — returns [].
 */
export async function searchMessages(
  query: string,
  options: MessageSearchOptions = {}
): Promise<MessageSearchResult[]> {
  if (!hasDb()) {
    console.warn('[MessageSearch] Database client not available. Returning empty results.');
    return [];
  }

  const term = (query || '').trim();
  if (!term) {
    return [];
  }

  // One resolved limit drives BOTH channels: the FTS query's bound `LIMIT ?`
  // and the hybrid merge's final cap. Clamped to [1, SEMANTIC_CANDIDATE_LIMIT]
  // so the candidate pool can never be smaller than what the merge keeps.
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? SEARCH_LIMIT)),
    SEMANTIC_CANDIDATE_LIMIT
  );
  const match = `"${escapeMatchTerm(term)}"`;

  let ftsRows: Record<string, unknown>[];
  try {
    ftsRows = (await expoDb.getAllAsync(
      `SELECT m.id, m.conversation_id, m.content, m.created_at, f.rank
       FROM messages_fts f
       JOIN messages m ON m.rowid = f.rowid
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [match, limit]
    )) as Record<string, unknown>[];
  } catch (error) {
    console.error('[MessageSearch] Search failed:', error);
    return [];
  }

  const embedder = resolveEmbedder(options);
  if (!embedder) {
    return ftsRows.map(toResult);
  }

  let queryVector: number[] | null;
  try {
    queryVector = await embedder(term);
  } catch (error) {
    console.warn('[MessageSearch] Query embedding failed; using lexical results only.', error);
    return ftsRows.map(toResult);
  }
  if (!queryVector || queryVector.length === 0) {
    return ftsRows.map(toResult);
  }

  let vectorRows: Record<string, unknown>[];
  try {
    vectorRows = (await expoDb.getAllAsync(
      `SELECT v.message_id, v.embedding, m.conversation_id, m.content, m.created_at
       FROM message_vectors v
       JOIN messages m ON m.id = v.message_id
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [SEMANTIC_CANDIDATE_LIMIT]
    )) as Record<string, unknown>[];
  } catch (error) {
    console.warn('[MessageSearch] Vector lookup failed; using lexical results only.', error);
    return ftsRows.map(toResult);
  }

  try {
    return mergeHybrid(ftsRows, vectorRows, queryVector, limit);
  } catch (error) {
    console.warn('[MessageSearch] Hybrid merge failed; using lexical results only.', error);
    return ftsRows.map(toResult);
  }
}

const INSERT_VECTOR_SQL = `INSERT INTO message_vectors (message_id, embedding, model, created_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(message_id) DO UPDATE SET
  embedding = excluded.embedding,
  model = excluded.model,
  created_at = excluded.created_at`;

/**
 * Stores (or replaces) the vector for one message. Returns false — without
 * throwing — when the vector is empty/non-finite, the database cannot write,
 * or the write fails. Never partial-writes a malformed vector.
 */
export async function saveMessageVector(
  messageId: string,
  vector: readonly number[],
  model: string = NEEDLE_PROBE_POOL_MODEL
): Promise<boolean> {
  if (!messageId || !Array.isArray(vector) || vector.length === 0) return false;
  if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  if (!expoDb || typeof expoDb.runAsync !== 'function') {
    console.warn('[MessageSearch] Database client not available. Vector not stored.');
    return false;
  }
  try {
    await expoDb.runAsync(INSERT_VECTOR_SQL, [messageId, JSON.stringify(vector), model, Date.now()]);
    return true;
  } catch (error) {
    console.error('[MessageSearch] Failed to store message vector:', error);
    return false;
  }
}

export interface IndexVectorsResult {
  /** Messages that now have a stored vector. */
  indexed: number;
  /** Messages skipped (embedder unavailable/failed, write rejected). */
  skipped: number;
}

/**
 * Backfill: embeds every message that has no stored vector yet. Used to seed
 * `message_vectors` before the #299 gate runs (and later by the write path
 * once the parked UI half is un-parked). Sequential on purpose — the native
 * engine is single-threaded.
 */
export async function indexMessageVectors(options: {
  embed: EmbedFn;
  limit?: number;
  model?: string;
}): Promise<IndexVectorsResult> {
  const result: IndexVectorsResult = { indexed: 0, skipped: 0 };
  if (!hasDb() || typeof expoDb.runAsync !== 'function' || !options.embed) {
    return result;
  }

  let pending: Record<string, unknown>[];
  try {
    pending = (await expoDb.getAllAsync(
      `SELECT m.id, m.content
       FROM messages m
       LEFT JOIN message_vectors v ON v.message_id = m.id
       WHERE v.message_id IS NULL
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [options.limit ?? SEMANTIC_CANDIDATE_LIMIT]
    )) as Record<string, unknown>[];
  } catch (error) {
    console.error('[MessageSearch] Vector backfill query failed:', error);
    return result;
  }

  for (const row of pending) {
    const messageId = String(row.id);
    let vector: number[] | null;
    try {
      vector = await options.embed(String(row.content ?? ''));
    } catch {
      vector = null;
    }
    if (!vector || vector.length === 0) {
      result.skipped += 1;
      continue;
    }
    const saved = await saveMessageVector(messageId, vector, options.model);
    if (saved) result.indexed += 1;
    else result.skipped += 1;
  }
  return result;
}

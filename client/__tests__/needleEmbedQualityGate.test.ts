/**
 * Quality gate for #299 "meaning-aware message search (needle_embed)".
 *
 * What runs here (hermetic):
 *   - The lexical half uses REAL FTS5 (node:sqlite) with the shipped schema,
 *     tokenizer and phrase semantics from migration 0002 — so "FTS5 misses the
 *     paraphrase" is measured, not assumed.
 *   - The semantic half uses INJECTED vectors that represent the hypothesised
 *     probe-pool geometry (paraphrase ≈ query, off-topic phrase hit ≈ far).
 *     They are NOT produced by needle_embed.
 *
 * What stays UNRUN: the same gate driven by the shipped `needle3.cact`
 * probe-pool vectors. needle_embed cannot execute in this environment (no
 * Android toolchain / no device), so the verdict is UNRUN — needs device.
 * Nothing in this file may be reported as a pass for the real engine.
 */

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
import { PARAPHRASE_PAIRS, runParaphraseGate } from '../db/messageEmbeddingGate';
import { applyMigrations } from './helpers/sqliteMigrations';
import NeedleModule from '../modules/needle';

const { DatabaseSync } = require('node:sqlite');

/** Matches the dimension needle_embed returns on the shipped needle3.cact. */
const VECTOR_DIM = 3072;

/** Unit vector from sparse (index, value) terms. */
function sparseUnit(terms: [number, number][]): number[] {
  const vector = new Array<number>(VECTOR_DIM).fill(0);
  let norm = 0;
  for (const [index, value] of terms) {
    vector[index] = value;
    norm += value * value;
  }
  const scale = Math.sqrt(norm) || 1;
  return vector.map((v) => v / scale);
}

/**
 * Representative stand-in for probe-pool geometry (see file header): each pair
 * occupies its own axis, paraphrase ~0.97 cosine to the query, off-topic
 * phrase hit ~0.15, strong lexical hit ~0.87, irrelevant exactly orthogonal.
 */
function buildInjectedVectors(): Map<string, number[]> {
  const vectors = new Map<string, number[]>();
  PARAPHRASE_PAIRS.forEach((pair, j) => {
    vectors.set(pair.query, sparseUnit([[j, 1]]));
    vectors.set(pair.paraphrase, sparseUnit([[j, 1], [100 + j, 0.25]]));
    vectors.set(pair.strongLexical, sparseUnit([[j, 0.9], [50 + j, 0.5]]));
    vectors.set(pair.lexicalNoise, sparseUnit([[j, 0.15], [200 + j, 1]]));
    vectors.set(pair.irrelevant, sparseUnit([[300 + j, 1]]));
  });
  return vectors;
}

const injectedVectors = buildInjectedVectors();
const injectedEmbed = async (text: string): Promise<number[] | null> =>
  injectedVectors.get(text) ?? null;

function buildFixtureDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyMigrations(sqlite);
  sqlite
    .prepare(
      'INSERT INTO threads (id, title, persona, updated_at, is_pinned) VALUES (?, ?, ?, ?, ?)'
    )
    .run('conv-gate', 'quality gate', 'personal assistant', '2026-01-01', 0);

  const insertMessage = sqlite.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertVector = sqlite.prepare(
    'INSERT INTO message_vectors (message_id, embedding, model, created_at) VALUES (?, ?, ?, ?)'
  );

  let clock = 1000;
  PARAPHRASE_PAIRS.forEach((pair) => {
    const contents: [string, string][] = [
      [`${pair.id}-strong`, pair.strongLexical],
      [`${pair.id}-noise`, pair.lexicalNoise],
      [`${pair.id}-paraphrase`, pair.paraphrase],
      [`${pair.id}-irrelevant`, pair.irrelevant],
    ];
    for (const [id, content] of contents) {
      clock += 1;
      insertMessage.run(id, 'conv-gate', 'user', content, 'local', clock);
      const vector = injectedVectors.get(content);
      if (vector) {
        insertVector.run(id, JSON.stringify(vector), 'needle3-probe-pool', clock);
      }
    }
  });

  return sqlite;
}

const fixtureDb = buildFixtureDb();

beforeAll(() => {
  (expoDb as any).getAllAsync = async (sql: string, params: unknown[] = []) => {
    const statement = fixtureDb.prepare(sql);
    return params.length > 0 ? statement.all(...(params as any[])) : statement.all();
  };
});

const rowIds = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('needle_embed quality gate fixture (#299)', () => {
  it('measures the FTS5 gap: paraphrases are unreachable lexically', async () => {
    for (const pair of PARAPHRASE_PAIRS) {
      const lexicalIds = rowIds(await searchMessages(pair.query, { embed: null }));
      // Real FTS5 (porter tokenizer, phrase query) reaches the two rows that
      // literally contain the query phrase...
      expect(lexicalIds).toContain(`${pair.id}-strong`);
      expect(lexicalIds).toContain(`${pair.id}-noise`);
      // ...and misses the paraphrase and the off-topic filler entirely.
      expect(lexicalIds).not.toContain(`${pair.id}-paraphrase`);
      expect(lexicalIds).not.toContain(`${pair.id}-irrelevant`);
    }
  });

  it('ranks injected-vector paraphrases above lexical noise and below the strong lexical hit', async () => {
    for (const pair of PARAPHRASE_PAIRS) {
      const hybridIds = rowIds(await searchMessages(pair.query, { embed: injectedEmbed }));
      const strong = hybridIds.indexOf(`${pair.id}-strong`);
      const paraphrase = hybridIds.indexOf(`${pair.id}-paraphrase`);
      const noise = hybridIds.indexOf(`${pair.id}-noise`);
      const irrelevant = hybridIds.indexOf(`${pair.id}-irrelevant`);

      // The lexical winner still wins — hybrid ranking must not regress FTS5.
      expect(strong).toBeGreaterThanOrEqual(0);
      expect(strong).toBeLessThan(paraphrase);
      // The FTS5-missed paraphrase now surfaces, above the phrase-only noise.
      expect(paraphrase).toBeGreaterThanOrEqual(0);
      expect(paraphrase).toBeLessThan(noise);
      // ...and off-topic filler stays at the bottom.
      expect(noise).toBeLessThan(irrelevant);
    }
  });

  it('passes the gate when the vectors behave as hypothesised', async () => {
    const report = await runParaphraseGate(injectedEmbed);
    expect(report.failures).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.results).toHaveLength(PARAPHRASE_PAIRS.length);
    for (const result of report.results) {
      expect(result.ok).toBe(true);
      expect(result.paraphraseCosine).toBeGreaterThan(result.noiseCosine);
    }
  });

  it('fails the gate loudly when the embedder returns nothing', async () => {
    const report = await runParaphraseGate(async () => null);
    expect(report.pass).toBe(false);
    expect(report.failures.length).toBe(PARAPHRASE_PAIRS.length);
  });

  it('fails the gate loudly when the embedder throws mid-pair', async () => {
    const report = await runParaphraseGate(async () => {
      throw new Error('engine died');
    });
    expect(report.pass).toBe(false);
    expect(report.failures.length).toBe(PARAPHRASE_PAIRS.length);
    // A throw must not leave a vector from an earlier await usable — every
    // pair reports the "no vector" failure, none reports a partial cosine.
    expect(report.failures.every((f) => f.includes('embed returned null'))).toBe(true);
    for (const result of report.results) {
      expect(result.paraphraseCosine).toBe(0);
      expect(result.noiseCosine).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // UNRUN — needs device. Verdict against the SHIPPED needle3.cact vectors.
  //
  // This environment has no Android toolchain/emulator, so needle_embed cannot
  // execute here and the gate verdict stays UNRUN (never "passed"). Per #299
  // the user-facing search half stays PARKED until this test is executed.
  //
  // To close the gate:
  //   1. cd client && npx expo run:android   (dev build shipping the Needle 3 engine)
  //   2. Load a local Needle model from Settings so needle_init has run
  //      (needle_embed needs an initialized engine; it returns null otherwise).
  //   3. From a temporary dev entry point — do NOT commit any of this UI — run:
  //        import NeedleModule from './modules/needle';
  //        import { runParaphraseGate } from './db/messageEmbeddingGate';
  //        const report = await runParaphraseGate((t) => NeedleModule.embed(t));
  //        console.log('[NEEDLE-GATE]', JSON.stringify(report));
  //   4. adb logcat -s ReactNativeJS | grep NEEDLE-GATE  → paste the JSON onto
  //      #299 as the resolution comment (pass / fail, honestly).
  // -------------------------------------------------------------------------
  it.skip(
    'QUALITY GATE — UNRUN (needs device): shipped needle3.cact probe-pool vectors rank paraphrases above lexical noise',
    async () => {
      const report = await runParaphraseGate((text) => NeedleModule.embed(text));
      expect(report.failures).toEqual([]);
      expect(report.pass).toBe(true);
    }
  );
});

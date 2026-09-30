/**
 * Paraphrase fixture for the #299 meaning-aware search quality gate.
 *
 * Why this exists
 * ---------------
 * `needle_embed` on the shipped `needle3.cact` returns a unit-norm vector from
 * the confidence head's probe pool — it is NOT a contrastively trained
 * embedding (#290), so its search quality is unproven. The gate asks a narrow
 * question: for paraphrase pairs that FTS5 cannot bridge, are the vectors at
 * least closer for the paraphrase than for an off-topic message that happens
 * to contain the query phrase?
 *
 * The pairs live here (not inside a test file) so the same fixture can be
 * driven with injected vectors in Jest AND with the real on-device embedder
 * when a human closes the gate — see the UNRUN note in
 * `__tests__/needleEmbedQualityGate.test.ts`.
 */

import { cosineSimilarity, type EmbedFn } from './messageSearch';

export interface ParaphrasePair {
  /** Stable id used by tests to address the seeded fixture rows. */
  id: string;
  /** What the Owner would type into search. */
  query: string;
  /** On-topic message that contains the exact query phrase → FTS5 hit. */
  strongLexical: string;
  /** Off-topic message that contains the exact query phrase → FTS5 hit. */
  lexicalNoise: string;
  /** Paraphrase with no shared query phrase → FTS5 miss. The thing we want. */
  paraphrase: string;
  /** Topic unrelated to the query → must stay at the bottom. */
  irrelevant: string;
}

/**
 * Six paraphrase pairs. FTS5 membership follows `searchMessages`' phrase
 * semantics (`"query"` quoted as a single phrase, porter tokenizer): only the
 * `strongLexical` / `lexicalNoise` rows are reachable lexically.
 */
export const PARAPHRASE_PAIRS: ParaphrasePair[] = [
  {
    id: 'train-delay',
    query: 'train delay',
    strongLexical: 'train delay on the northern line this morning',
    lexicalNoise: 'please file the train delay report with HR by friday',
    paraphrase: 'the railway was delayed',
    irrelevant: 'birthday party planning for june',
  },
  {
    id: 'doctor-appointment',
    query: 'doctor appointment',
    strongLexical: 'doctor appointment at the clinic on monday',
    lexicalNoise: 'update the doctor appointment field in the onboarding form',
    paraphrase: 'seeing the physician for a checkup',
    irrelevant: 'grocery list for the weekend',
  },
  {
    id: 'buy-milk',
    query: 'buy milk',
    strongLexical: 'remember to buy milk on the way home',
    lexicalNoise: 'buy milk loyalty cards are issued at the deli counter',
    paraphrase: 'purchase groceries this evening',
    irrelevant: 'renew the passport before travelling',
  },
  {
    id: 'flight-cancellation',
    query: 'flight cancellation',
    strongLexical: 'flight cancellation due to the snowstorm',
    lexicalNoise: 'flight cancellation policy is described in clause 12',
    paraphrase: 'the plane was called off',
    irrelevant: 'water the plants daily',
  },
  {
    id: 'wifi-password',
    query: 'wifi password',
    strongLexical: 'wifi password is on the router sticker',
    lexicalNoise: 'wifi password reset requests go to the it desk',
    paraphrase: 'the wireless network key',
    irrelevant: 'schedule a dentist visit',
  },
  {
    id: 'birthday-gift',
    query: 'birthday gift',
    strongLexical: 'birthday gift for my sister arrived',
    lexicalNoise: 'birthday gift vouchers must be claimed before may',
    paraphrase: 'a present for the celebration',
    irrelevant: 'fix the leaking tap',
  },
];

export interface GatePairResult {
  id: string;
  query: string;
  /** cosine(query, paraphrase) — the hit we want to be large. */
  paraphraseCosine: number;
  /** cosine(query, lexicalNoise) — phrase match that should rank lower. */
  noiseCosine: number;
  ok: boolean;
}

export interface GateReport {
  pass: boolean;
  results: GatePairResult[];
  failures: string[];
}

/**
 * Runs the gate with whatever embedder is supplied: injected vectors in CI, or
 * `NeedleModule.embed` on a device with the shipped `needle3.cact` loaded.
 *
 * Pass criterion is directional only — paraphrase cosine must beat the
 * off-topic phrase-hit cosine. No calibrated similarity threshold is claimed:
 * the vectors are unvalidated probe-pool output (#290/#299).
 */
export async function runParaphraseGate(embed: EmbedFn): Promise<GateReport> {
  const results: GatePairResult[] = [];
  const failures: string[] = [];

  for (const pair of PARAPHRASE_PAIRS) {
    let queryVector: number[] | null = null;
    let paraphraseVector: number[] | null = null;
    let noiseVector: number[] | null = null;
    try {
      [queryVector, paraphraseVector, noiseVector] = await Promise.all([
        embed(pair.query),
        embed(pair.paraphrase),
        embed(pair.lexicalNoise),
      ]);
    } catch {
      // One rejected embed invalidates the whole trio: never let a vector
      // resolved alongside a throw survive into the comparison.
      queryVector = null;
      paraphraseVector = null;
      noiseVector = null;
    }

    if (!queryVector || !paraphraseVector || !noiseVector) {
      failures.push(`${pair.id}: embed returned null (engine missing / not initialized)`);
      results.push({
        id: pair.id,
        query: pair.query,
        paraphraseCosine: 0,
        noiseCosine: 0,
        ok: false,
      });
      continue;
    }

    const paraphraseCosine = cosineSimilarity(queryVector, paraphraseVector);
    const noiseCosine = cosineSimilarity(queryVector, noiseVector);
    const ok = paraphraseCosine > noiseCosine;
    if (!ok) {
      failures.push(
        `${pair.id}: paraphrase cosine ${paraphraseCosine.toFixed(4)} <= ` +
          `lexical-noise cosine ${noiseCosine.toFixed(4)}`
      );
    }
    results.push({ id: pair.id, query: pair.query, paraphraseCosine, noiseCosine, ok });
  }

  return { pass: failures.length === 0, results, failures };
}

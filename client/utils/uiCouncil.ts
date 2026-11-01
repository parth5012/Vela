/**
 * UI council screenshot-scoring orchestration (WF-499-08 / issue #507).
 *
 * Pure logic only: no network, no filesystem. Model calls are injected via a
 * `Scorer` so the orchestration (cost-control gating, escalation order,
 * non-determinism probe) is fully testable without API keys.
 */

export const COUNCIL_MEMBERS = ['sol', 'opus', 'muse'] as const;
export type CouncilMember = (typeof COUNCIL_MEMBERS)[number];
export type CouncilModel = CouncilMember | 'jester';

export const PASS_THRESHOLD = 9;
export const DEFAULT_ESCALATION_THRESHOLD = 7;
export const NON_DETERMINISM_SAMPLES = 3;

export interface CouncilOptions {
  passThreshold?: number;
  escalationThreshold?: number;
  nonDeterminismSamples?: number;
  nonDeterminismModel?: CouncilModel;
}

export function shouldEscalate(score: number, threshold: number = DEFAULT_ESCALATION_THRESHOLD): boolean {
  return Number.isFinite(score) && score >= threshold;
}

export function allCouncilPass(
  scores: Partial<Record<CouncilMember, number>>,
  passThreshold: number = PASS_THRESHOLD,
): boolean {
  return COUNCIL_MEMBERS.every((m) => {
    const v = scores[m];
    return typeof v === 'number' && v >= passThreshold;
  });
}

export interface NonDeterminismProbe {
  model: CouncilModel;
  samples: number[];
  min: number;
  max: number;
  spread: number;
  mean: number;
  stdDev: number;
}

export function computeProbeStats(model: CouncilModel, samples: number[]): NonDeterminismProbe {
  const n = samples.length;
  const min = n ? Math.min(...samples) : 0;
  const max = n ? Math.max(...samples) : 0;
  const mean = n ? samples.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n ? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;
  const stdDev = Math.sqrt(variance);
  return { model, samples: [...samples], min, max, spread: max - min, mean, stdDev };
}

export interface UiScoreRound {
  round: number;
  screenshotPath: string;
  timestamp: string;
  thresholds: { pass: number; escalation: number };
  escalated: CouncilModel[];
  scores: Partial<Record<CouncilMember, number>>;
  jester: { score: number; ignored: true };
  nonDeterminism: NonDeterminismProbe;
  allCouncilPass: boolean;
}

export type Scorer = (model: CouncilModel, screenshotPath: string) => number | Promise<number>;

export async function runCouncilRound(
  screenshotPath: string,
  scorer: Scorer,
  round: number = 1,
  options: CouncilOptions = {},
): Promise<UiScoreRound> {
  const passThreshold = options.passThreshold ?? PASS_THRESHOLD;
  const escalationThreshold = options.escalationThreshold ?? DEFAULT_ESCALATION_THRESHOLD;
  const sampleCount = options.nonDeterminismSamples ?? NON_DETERMINISM_SAMPLES;
  const probeModel = options.nonDeterminismModel ?? 'sol';

  const scores: Partial<Record<CouncilMember, number>> = {};
  const escalated: CouncilModel[] = [];

  // 1. Sol (cheapest) first.
  const solScore = await scorer('sol', screenshotPath);
  scores.sol = solScore;
  escalated.push('sol');

  // 2. Escalate to Opus only if Sol clears the escalation threshold.
  if (shouldEscalate(solScore, escalationThreshold)) {
    const opusScore = await scorer('opus', screenshotPath);
    scores.opus = opusScore;
    escalated.push('opus');

    // 3. Escalate to Muse only if Opus clears the escalation threshold.
    if (shouldEscalate(opusScore, escalationThreshold)) {
      const museScore = await scorer('muse', screenshotPath);
      scores.muse = museScore;
      escalated.push('muse');
    }
  }

  // 4. Jester (Gemini) runs last; its score is logged but ignored.
  const jesterScore = await scorer('jester', screenshotPath);

  // 5. Non-determinism probe: re-score the same screenshot N times.
  const probeSamples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    probeSamples.push(await scorer(probeModel, screenshotPath));
  }
  const nonDeterminism = computeProbeStats(probeModel, probeSamples);

  return {
    round,
    screenshotPath,
    timestamp: new Date().toISOString(),
    thresholds: { pass: passThreshold, escalation: escalationThreshold },
    escalated,
    scores,
    jester: { score: jesterScore, ignored: true },
    nonDeterminism,
    allCouncilPass: allCouncilPass(scores, passThreshold),
  };
}

export async function runCouncilUntilPass(
  screenshotPath: string,
  scorer: Scorer,
  options: CouncilOptions & { maxRounds?: number } = {},
): Promise<UiScoreRound[]> {
  const maxRounds = options.maxRounds ?? 5;
  const rounds: UiScoreRound[] = [];
  for (let r = 1; r <= maxRounds; r++) {
    const round = await runCouncilRound(screenshotPath, scorer, r, options);
    rounds.push(round);
    if (round.allCouncilPass) break;
  }
  return rounds;
}

export function formatRoundFilename(round: number): string {
  return `round-${round}.json`;
}

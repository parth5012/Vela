#!/usr/bin/env -S npx tsx
/**
 * UI council screenshot-scoring harness (WF-499-08 / issue #507).
 *
 * Usage:
 *   npx tsx scripts/ui-council.ts --dry-run [screenshot.png]
 *   npx tsx scripts/ui-council.ts screenshot.png --out ui-score.json
 *
 * Cost-control sequence: Sol (cheapest) -> Opus -> Muse, escalating only when
 * the previous model clears the escalation threshold. Jester (Gemini) runs last;
 * its score is logged but ignored. Non-determinism is tracked by re-scoring the
 * same screenshot N times.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  runCouncilRound,
  runCouncilUntilPass,
  type Scorer,
  type CouncilModel,
} from '../client/utils/uiCouncil.ts';

interface Args {
  screenshot?: string;
  out: string;
  outDir?: string;
  round: number;
  rounds: number;
  maxRounds: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: 'ui-score.json', round: 1, rounds: 1, maxRounds: 5, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--screenshot' || a === '-s') args.screenshot = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--round') args.round = Number(argv[++i]);
    else if (a === '--rounds') args.rounds = Number(argv[++i]);
    else if (a === '--max-rounds') args.maxRounds = Number(argv[++i]);
    else if (a === '--out-dir') args.outDir = argv[++i];
    else if (!a.startsWith('-') && !args.screenshot) args.screenshot = a;
  }
  return args;
}

function envKey(model: CouncilModel): string | undefined {
  switch (model) {
    case 'sol':
      return process.env.OPENAI_API_KEY ?? process.env.SOL_API_KEY;
    case 'opus':
      return process.env.ANTHROPIC_API_KEY ?? process.env.OPUS_API_KEY;
    case 'muse':
      return process.env.MUSE_API_KEY ?? process.env.OPENAI_API_KEY;
    case 'jester':
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  }
}

function makeDryRunScorer(): Scorer {
  const base: Record<CouncilModel, number> = { sol: 8, opus: 9, muse: 9, jester: 7 };
  return (model) => base[model];
}

const realScorer: Scorer = async (model) => {
  const key = envKey(model);
  if (!key) {
    throw new Error(`Missing API key for ${model} (set the relevant env var).`);
  }
  // Real provider calls are intentionally not wired in this harness scaffold;
  // plug in provider SDK calls here when keys are available.
  throw new Error(`Real scoring not implemented for ${model}; use --dry-run or implement provider call.`);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const screenshot = args.screenshot ?? 'screenshot.png';

  if (!args.dryRun) {
    for (const m of ['sol', 'opus', 'muse', 'jester'] as CouncilModel[]) {
      if (!envKey(m)) console.warn(`WARN: no API key found for ${m}`);
    }
  }

  const scorer: Scorer = args.dryRun ? makeDryRunScorer() : realScorer;

  const rounds =
    args.rounds > 1
      ? await runCouncilUntilPass(screenshot, scorer, { maxRounds: args.maxRounds })
      : [await runCouncilRound(screenshot, scorer, args.round)];

  for (const r of rounds) {
    const file = args.outDir
      ? resolve(args.outDir, `round-${r.round}.json`)
      : rounds.length === 1
      ? resolve(args.out)
      : resolve(`ui-score-round-${r.round}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(r, null, 2));
    console.log(`Wrote ${file}`);
  }

  const last = rounds[rounds.length - 1];
  const primary = resolve(args.out);
  writeFileSync(primary, JSON.stringify(last, null, 2));
  console.log(`Wrote ${primary}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

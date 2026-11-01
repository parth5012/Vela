# UI Council Screenshot Scoring Harness

WF-499-08 / issue #507.

## Overview

A quality council that scores UI screenshots 1-10 using three council members
plus a "Jester":

- **Sol** (GPT) — cheapest, runs first.
- **Opus** — escalated only when Sol clears the escalation threshold.
- **Muse** — escalated only when Opus clears the escalation threshold.
- **Jester** (Gemini) — runs last; score logged but ignored.

Iterate rounds until all council members score >= 9 (pass threshold).

## Cost control

Cheaper models first: Sol -> Opus -> Muse. Escalation happens only when the
previous model's score clears the escalation threshold (default 7). This avoids
paying for expensive models on obviously-bad screenshots.

## Non-determinism tracking

Each round re-scores the same screenshot `NON_DETERMINISM_SAMPLES` (3) times and
records min/max/spread/std-dev in `nonDeterminism`.

## Usage

```sh
# Dry run (no API keys required) — writes ./ui-score.json
npx tsx scripts/ui-council.ts --dry-run screenshot.png

# Real run (requires env keys)
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... \
  npx tsx scripts/ui-council.ts screenshot.png --out ui-score.json

# Multiple rounds, per-round files
npx tsx scripts/ui-council.ts screenshot.png --rounds 3 --out-dir ui-scores
```

## Output

`ui-score.json` (per round when `--out-dir` is used: `ui-scores/round-<n>.json`).
Shape:

```json
{
  "round": 1,
  "screenshotPath": "screenshot.png",
  "timestamp": "2026-...",
  "thresholds": { "pass": 9, "escalation": 7 },
  "escalated": ["sol", "opus", "muse"],
  "scores": { "sol": 8, "opus": 9, "muse": 9 },
  "jester": { "score": 7, "ignored": true },
  "nonDeterminism": { "model": "sol", "samples": [8,8,8], "min":8, "max":8, "spread":0, "mean":8, "stdDev":0 },
  "allCouncilPass": false
}
```

## Testable core

Pure orchestration lives in `client/utils/uiCouncil.ts` (importable by Jest).
The CLI is a thin wrapper. Run tests:

```sh
cd client && npx jest __tests__/uiCouncil.test.ts
```

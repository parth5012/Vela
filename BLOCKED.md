# Blockers

> Agent writes here when it cannot proceed. Human resolves and unblocks.

## Active Blockers

_None yet._

| ID | Date | Description | Attempted | Needs |
|----|------|-------------|-----------|-------|
| B1 | 2026-10-30 | `ocr_review` self-review could not run for the map-#490 stack (#524–#529): the local LLM proxy at `http://localhost:20128/v1` returns `000` (connection refused), and `ocr_health` reports no reachable model | `curl http://localhost:20128/v1/models` retried throughout the run and again at handback; CodeRabbit/parthpr review only covers PRs into the default branch, so the stacked sub-PRs got no bot review either | A reachable OpenAI-compatible endpoint for OpenCodeReview, then run `ocr_review` on each stack range `#491 → #496`; the stack is otherwise green |

## Resolved Blockers

_None yet._

| ID | Date Resolved | Description | Resolution |
|----|---------------|-------------|------------|
| —  | —             | —           | —          |

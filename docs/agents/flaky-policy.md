# Flaky test policy (quarantine + one retry) — map WF-541, ticket #552

Decisions #542, applied from ticket #552 onward. The single definition of
"green" stays `python vela_ci.py ci` (stacks: backend, client, corpus, bugs).

## Retry: exactly one, then it is a real failure

1. If a lane fails, re-run **that lane once**, unchanged.
2. If the retry passes, it was a flake — note it in the PR / ledger entry and
   move on. Do not special-case the gate around it.
3. If the retry fails the same way, it is **not a flake anymore**: fix the
   test or the code. Never re-run until green, never lower a threshold to
   get there.

Provenance for this rule: `incrementalParser.test.ts` timed a 25 ms
cumulative-parse budget at 26 ms under a coverage-instrumented full run, then
passed on the immediate retry (4 ms solo). That is worker contention, not a
product regression.

## Quarantine: how a suite leaves a lane, and how it returns

Quarantine is for suites that **cannot pass in that lane** — not for slow or
annoying ones. A quarantine entry must be written down, here, with all five:

| Field | Meaning |
|---|---|
| Suite | File (and lane), e.g. `__tests__/setup.test.tsx` (jest-coverage lane) |
| Reason | Root cause, not just "flaky" |
| Evidence | Fails in lane, passes solo / in the other lane |
| Tracking | Issue or `BUG-*` id |
| Review by | A date; an expired quarantine **blocks merge** until re-approved |

Quarantine excludes the suite from **one lane only** if it still runs green
elsewhere (prefer a lane exclusion over deleting or skipping the test).
Expired quarantines block: a human re-approves with a new date or the suite
is fixed/un-quarantined before the PR lands.

### Current quarantines

- `__tests__/setup.test.tsx`, **jest-coverage lane only** (main `jest` step
  still runs it). Under coverage instrumentation an RN `Animated` native call
  fires before teardown and kills the worker (`ChildProcessWorker.initialize`
  crash); it passes standalone and in the main lane. Tracking: BUG-client-001
  class (worker/infra, not product). Exclusion lives in
  `vela_ci.py` (`CLIENT_COVERAGE_IGNORE_PATTERNS`). Review by: 2027-05-09.

## Perf lanes: timing tests never run under coverage

Wall-clock assertions are the flake factory of this repo (BUG-client-001
class). The lanes are kept separate on purpose:

- `benchmark:ci` (`perf.benchmark` / `perf.cuj`, `--runInBand`) and the
  `perf-gate` workflow own the timing ratchets. They run **without**
  instrumentation: coverage slows execution and breaks the ratchets.
- The `jest-coverage` step in `vela_ci.py` therefore excludes
  `perf.benchmark` / `perf.cuj` (in addition to the quarantine above) and
  the coverage report will not include them either.
- When a suite carries a wall-clock budget (e.g. `incrementalParser`), expect
  one-retry behavior under contention; if it fails twice, the budget or the
  implementation is the bug — not the policy.

## Coverage floors (never lower)

- **Backend: 60%** — enforced by `vela_ci.py` (`--cov-fail-under=60`,
  `BACKEND_COVERAGE_FLOOR`); omit patterns in `backend/pyproject.toml`
  (`[tool.coverage.run]`). Local `pytest -q` stays coverage-free; the gate
  is what blocks merges.
- **Client: 50%** (statements/branches/functions/lines) — enforced by
  `client/package.json` (`coverageThreshold`) on the `jest-coverage` step.
  Plain `npx jest` never measures, so it never gates.
- Floors only **ratchet up**, with evidence the new level holds (like the
  corpus pass floors in `backend/corpus/floors.py`). Never lower a floor or
  edit a fixture expectation to get green. Current headroom at wiring time:
  backend ~80%, client ~61/54/55/62.

## Stale expectations

A test that encodes yesterday's behavior is resolved against the spec, not by
tweaking the assertion to current output. If the spec changed, update the test
in the same PR as the behavior it pins.

## Mutation testing

Required for critical modules (auth gating, session/DB, SSE/execution
boundaries — the suites from map WF-541 are the seed), **report-only**
elsewhere. A full mutation runner is deferred; the claim to defend today is
"critical modules have decision-level tests that fail when the logic is
reversed", via the per-vector buggy-flip evidence pattern used in the AFK
sweeps.

## Bug regressions (BUGS.toml)

Every bugfix PR ships a test that **fails on the old code and passes after
the fix**. `status = "fixed"` requires `failing_test` in the
`BUGS.toml` entry; `python vela_ci.py bugs` (and `ci`) rejects a fixed entry
without one. Do not fabricate entries — a bug you cannot reproduce is
`open`/`mitigated`, not `fixed`.

## Migration cache

Editing only `db/migrations/*.sql` leaves Jest's transform cache stale
(`babel-plugin-inline-import` inlines the SQL). Run `npx jest --clearCache`
before trusting a red or green run (LEARNINGS.md). Same for
`client/__tests__/helpers/memoryDb.ts` runs: the cache key does not track
`.sql` sources.

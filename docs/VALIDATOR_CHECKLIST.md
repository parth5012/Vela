# Software Factory Validator Checklist

> Per-PR compliance and architecture audit checklist for Vela.
> Used by the Validator subagent and human reviewers before landing changes.

## 1. Architectural Contract Adherence

- [ ] **Context-First Verification**: Did the author consult `docs/ARCHITECTURE_CONTRACT.md` before making architectural decisions?
- [ ] **Automated Boundary Check**: Does `cd client && npm run arch:check` pass cleanly with 0 violations?
- [ ] **Backend Boundary Check**: Does `cd backend && uv run pytest tests/test_architecture_boundaries.py` pass cleanly?
- [ ] **Client Layering Invariants**:
  - [ ] No component imports from `client/app/**` (screens).
  - [ ] No component imports from `client/db/**` (components consume state via stores or hooks).
  - [ ] No store imports from `client/components/**` or `client/app/**`.
  - [ ] No utility imports from `client/components/**` or `client/app/**`.
  - [ ] Types package remains a pure leaf.
- [ ] **Runtime Isolation**: Strictly zero source cross-imports between `client/` and `backend/`. Communication is exclusively network-driven (REST, SSE, WebSocket).

---

## 2. Performance Ratchet & Baseline Protection

- [ ] **Baseline Lock**: Does the PR modify `perf-baseline.json`?
  - If **NO**: Pass.
  - If **YES**: Confirm the PR carries the `perf-ratchet-forward` label explicitly applied by a human. If the label is missing, the change is **blocked**.
- [ ] **Tier-1 CUJ Impact**: Are any hot-path metrics affected?
  - `cold_start_to_typeable_ms`
  - `send_to_bubble_ms`
  - `stream_100_token_settle_ms`
- [ ] **Regression Report**: Did the shadow-mode ratchet output in CI indicate any metric regressions beyond calibrated noise margins?

---

## 3. Engineering Rigor & Quality Standards

- [ ] **TDD Discipline**: Every bug fix or new behavior is backed by a reproducing test (red → green → refactor).
- [ ] **Typecheck**: `cd client && npx tsc --noEmit` exits 0 with zero errors.
- [ ] **CI Green**: Root `python vela_ci.py ci` passes cleanly across touched stacks.
- [ ] **Documentation**: `LEARNINGS.md` updated if edge cases were discovered; `LOG.md` entry recorded.

---

## 4. Merge Gate

- [ ] **No Auto-Merge**: Human review and explicit merge action required.
- [ ] **Zero Contract Blockers**: No unaddressed or unparked architectural violations.

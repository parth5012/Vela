# Vela Software Factory Ledger

> Empirical metrics and catch-rate tracking for factory-executed features and bugfixes.
> Evaluates whether automated factory gates prevent regressions and save engineering time.

---

## 1. Metric Definitions & Purpose

The factory tracks three core metrics per completed task to measure factory efficacy:

1. **Contract-Violation Catch Count (`Catches (Mech / Agent)`)**:
   - Number of forbidden dependency directions, illegal cross-module imports, or schema boundary violations caught before landing.
   - Split into mechanical violations (caught by `npm run arch:check` / pytest AST boundary tests) vs semantic violations (caught by `validator` audit agent).
   - **Zero-Catch-Rate Caveat**: *Zero violations caught across multiple tasks usually indicates weak, permissive checks or underspecified contract rules, not flawless agents. Continuous contract tuning is required when catch rates remain at zero.*

2. **Blueprint Corrections Count (`Blueprint Corrections`)**:
   - Number of corrections or amendments required by the human reviewer during the ≤ 5-minute blueprint approval gate.
   - Measures prompt drift, misaligned scope, or ambiguity in upstream user stories.

3. **Time Delta vs Manual (`Wall-Clock / Human Touch vs Manual`)**:
   - Total wall-clock elapsed time from research to PR merge.
   - Human touch-time (minutes spent reviewing blueprint, approving PR, or providing unblocking feedback).
   - Estimated engineering time for equivalent manual human implementation.

---

## 2. Factory Task Log

| Task / PR | Description | Contract Boundaries Touched | Catches (Mech / Agent) | Blueprint Corrections | Wall-Clock (min) | Human Touch (min) | Manual Est (min) | Verdict / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
<!-- Add rows below as factory tasks complete. Do not pre-populate with synthetic rows. -->

---

## 3. Review & Iteration Guidance

- Inspect the ledger during monthly retrospective or sprint reviews.
- If **Catches** are consistently 0: audit `docs/ARCHITECTURE_CONTRACT.md` and dependency-cruiser rules for coverage gaps.
- If **Blueprint Corrections** exceed 2 per task: refine upstream `story-writer` and `researcher` prompt constraints.
- If **Human Touch** exceeds 15 minutes: evaluate whether the blueprint gate criteria in `docs/BLUEPRINT_GATE_CHECKLIST.md` are being strictly observed.

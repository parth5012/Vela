# Performance Gate Calibration & Shadow Protocol

> Operational protocol for the Vela Tier-1 Critical User Journey (CUJ) Performance Ratchet.
> Standardizes the transition from shadow mode (report-only) to hard blocking.

---

## 1. Core Principle & Rationale

> **"A gate that fires falsely twice becomes theater."**

Performance benchmarks in shared cloud CI virtual machines encounter noisy neighbors, CPU throttling, and scheduling variance. If a performance ratchet blocks pull requests due to environmental jitter, engineers quickly learn to ignore or bypass it.

Therefore, the ratchet gate operates strictly in **shadow mode (report-only)** until baseline variance is empirically calibrated across real PR executions.

---

## 2. Phase 1: Shadow Collection Protocol

During the shadow phase:
1. Every PR executes the Tier-1 CUJ harness and benchmarks (`npm run cuj:benchmark`).
2. `scripts/ratchet.py` compares current results against locked `perf-baseline.json`.
3. In shadow mode (`SHADOW_MODE: "true"`), the CI step **always exits 0**. Regressions and deltas are surfaced as a GitHub Step Summary and PR comment titled:
   `### 🔊 Perf ratchet (shadow): did not block`
4. Metric observations must be collected across a minimum of **3 real feature PRs** before calibration.

### Per-Metric Variance Collection:
For each metric $M$, record the 5-run trimmed mean across PR runs:
$$\Delta_{spread}(M) = \frac{\max(M) - \min(M)}{\text{median}(M)} \times 100\%$$

---

## 3. Phase 2: Flip Criteria & Calculation

To graduate the gate from shadow mode to blocking:

1. **Calculate Calibrated Tolerance**:
   For each metric $M$, the allowed regression threshold is set to:
   $$\text{Tolerance}(M) = \max\left(5.0\%,\; \Delta_{spread}(M) \times 1.5\right)$$
   If per-metric tolerances are uniform, the global `--max-regression` flag is calibrated to this value (default: `10.0%`).

2. **Zero-Flake Verification**:
   The benchmark harness must have demonstrated zero non-deterministic assertion failures across the observation window.

3. **Human Flip Execution**:
   - **Only a human maintainer** may flip the gate from shadow to blocking.
   - Change `SHADOW_MODE: "true"` to `SHADOW_MODE: "false"` in `.github/workflows/perf-gate.yml`.
   - Record the flip decision and calibration data in Wayfinder Map #462's *Decisions* section.
   - Agents are strictly prohibited from flipping the gate autonomously.

---

## 4. Machine-Enforced Baseline Protection

To uphold the locked invariant that **agents never advance the baseline**:
- CI mechanically enforces that `perf-baseline.json` cannot be modified in any PR unless the PR carries the `perf-ratchet-forward` label.
- The `perf-ratchet-forward` label (color: `#F9A825`) can only be applied by a human maintainer.
- If `perf-baseline.json` is modified without this label, the CI job fails hard (`exit 1`) immediately, halting execution before any code is reviewed or merged.

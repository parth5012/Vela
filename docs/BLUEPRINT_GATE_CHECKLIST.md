# Blueprint Approval Gate Checklist

> Human-in-the-loop review criteria for feature blueprints.
> **Target time: ≤ 5 minutes.**

---

## 1. Scope of the Gate

The blueprint approval gate is the **single human gate** in the feature pipeline. 
The human evaluates **interpretation and intent**, not mechanical syntax or boilerplate.

### What the Human Approves:
- [ ] **Problem Interpretation**: Does this plan build the right thing? Does it address the true user requirement without unnecessary scope creep?
- [ ] **Contract Boundaries**: Does the blueprint explicitly enumerate which modules and certified boundaries from `docs/ARCHITECTURE_CONTRACT.md` are touched? Are any forbidden dependency directions planned?
- [ ] **CUJ Impact**: Does the blueprint identify which Tier-1 Critical User Journeys (`cold_start_to_typeable_ms`, `send_to_bubble_ms`, `stream_100_token_settle_ms`) may be affected and describe how latency regressions will be avoided?

### What the Human Ignores:
- **Do not debate code style, naming nuances, or formatting**: Linter and mechanical tools handle this.
- **Do not micromanage file layout details**: As long as layer boundaries are respected, agent internal scaffolding is autonomous.
- **Do not review boilerplate**: Focus solely on domain boundaries, data models, and user experience.

---

## 2. Decision Outcomes

1. **Approve**: Blueprint interpretation is sound. Agent proceeds to autonomous AFK implementation.
2. **Amend**: Interpretation is slightly off (e.g., misidentified domain owner or missed edge case). Human provides concise corrections, agent updates blueprint for immediate re-check.
3. **Reject**: Feature premise is invalid, violates fundamental architecture principles, or should not be built.

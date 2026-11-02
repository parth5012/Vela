# Vela Software Factory Pipeline

> Standard operating pipeline for automated and agent-driven feature engineering in Vela.
> Encodes the sealed session model: **the factory is a contract amplifier**.

---

## 1. Pipeline Topology

```
research → story → blueprint → ⟨HUMAN GATE: approve interpretation⟩
        → implement (parallel, worktree-isolated)
        → validate (contract checks + validator agent + ratchet result)
        → PR review (OCR + CodeRabbit) → HUMAN MERGES (never auto-merge)
```

---

## 2. Stage Breakdown & Ownership

### Stage 1: Research
- **Owner**: Agent (`researcher` / `explore`)
- **Action**: Sweeps existing code, dependencies, and external docs. Probes AST and database structures without modifying source.
- **Exit Criteria**: Crisp research report detailing constraints, affected components, and prior art.

### Stage 2: Story
- **Owner**: Agent (`story-writer`)
- **Action**: Converts requirements into structured user stories with unambiguous acceptance criteria and edge cases.
- **Exit Criteria**: Story markdown specifying testable user expectations.

### Stage 3: Blueprint
- **Owner**: Agent (`technical-blueprint`)
- **Action**: Produces the technical implementation plan: files to create/edit, DB migrations, API contracts, certified architecture sections touched, and CUJ latency impact.
- **Exit Criteria**: Blueprint adhering to `docs/ARCHITECTURE_CONTRACT.md`.

### Stage 4: Human Gate (Single Human Checkpoint)
- **Owner**: Human (≤ 5 minutes)
- **Action**: Human verifies problem interpretation against `docs/BLUEPRINT_GATE_CHECKLIST.md`. Approves or amends direction before code execution.
- **Exit Criteria**: Explicit human approval recorded. Agents do not proceed without it.

### Stage 5: Implementation (AFK)
- **Owner**: Agent (`coder-agent` / `ship-coder`)
- **Action**: Autonomous, worktree-isolated implementation. Employs TDD (failing test first), adheres to existing idioms, makes minimal necessary diffs.
- **Exit Criteria**: Local compilation clean (`npx tsc --noEmit`), unit/integration tests passing.

### Stage 6: Validation (AFK)
- **Owner**: Agent (`validator`)
- **Action**: Multi-axis compliance audit against `docs/VALIDATOR_CHECKLIST.md`:
  1. Mechanical boundary check (`npm run arch:check` & `uv run pytest tests/test_architecture_boundaries.py`).
  2. Performance ratchet check (`python3 scripts/ratchet.py`).
  3. Scope and security inspection against the approved blueprint.
- **Exit Criteria**: Zero contract violations, performance within threshold, validation report logged.

### Stage 7: PR Review & CI (AFK)
- **Owner**: Agent (`babysit-pr` / `ocr-review` / CodeRabbit)
- **Action**: Opens stacked or feature PR, monitors CI checks (`python vela_ci.py ci`), executes OCR code review, resolves actionable feedback.
- **Exit Criteria**: All checks green, PR template completed with factory fields.

### Stage 8: Human Merge Gate
- **Owner**: Human
- **Action**: Human audits the finalized PR, reviews ratchet report, and executes merge.
- **Locked Rule**: Auto-merge is strictly forbidden. Only humans land code on main.

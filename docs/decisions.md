# Architecture Decisions

> ADR-style log of significant decisions. Canonical ADRs live in `docs/adr/` (see below); this file is a running index/log.

## Format

### [DATE]: [Title]

- **Status**: Proposed | Accepted | Superseded
- **Context**: Why this decision was needed
- **Decision**: What was decided
- **Consequences**: Trade-offs and implications

## Decisions

### 2026-08-10: Harness documentation layout

- **Status**: Accepted
- **Context**: Set up agent harness files for future sessions.
- **Decision**: Added `BLOCKED.md`, `LEARNINGS.md`, `LOG.md`, `TECH_DEBT.md` at the repo root plus `docs/architecture.md`, `docs/decisions.md`, `docs/patterns.md` under `docs/`.
- **Consequences**: Agents have stable places to record blockers, learnings, iterations, and debt; docs align with the existing single-context layout.

## Canonical ADRs (docs/adr/)

- **0001** — Unified Agents and explicit tool binding (`docs/adr/0001-unified-agents-and-explicit-tool-binding.md`)
- **0002** — Google Workspace tools and auto-refresh propagation (`docs/adr/0002-google-workspace-tools-and-auto-refresh-propagation.md`)
- **0003** — Agent database schema evolution (`docs/adr/0003-agent-database-schema-evolution.md`)

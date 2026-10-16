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

### 2026-09-29: Needle engine vendoring (fetch-at-build) and link-time model selection

- **Status**: Accepted
- **Context**: Wayfinder #293 — upstream (Cactus Compute) ships only static per-ABI `libneedle.a` archives; there is no `libneedle.so` anywhere (research #292), so the original "drop `.so` into `jniLibs/`" plan could not work, and committing all archives would add ~75 MB of binaries to git history.
- **Decision**: Fetch-at-build with pinned URLs + SHA256 (`client/modules/needle/scripts/fetch-engine.js` + `scripts/engine.lock.json`) into the gitignored `client/modules/needle/android/engine/` directory; CMake links the archive statically (`add_library(needle_engine STATIC IMPORTED)`) into our own JNI `libneedle.so` and defines `HAVE_NEEDLE_ENGINE`. No binaries are committed; Apache-2.0 text + Cactus Compute attribution ship in `client/modules/needle/android/THIRD_PARTY_NOTICES.md`. needle2 and needle3 export the *same* `needle_*` symbols, so exactly one archive can be linked per shared object: **link-time selection** via `-DNEEDLE_ENGINE_MODEL=needle3|needle2` (default needle3), not a runtime model switch — a runtime switch would need separate link units (upstream itself ships libneedle2/libneedle3 as separate CDLLs) and is deferred.
- **Consequences**: first build needs network + node (afterwards cached and checksum-verified); builds without the archive keep the honest mock fallback (`HAVE_NEEDLE_ENGINE=0`, surfaced by the "Mock Fallback" pill); switching engine generation requires a rebuild, and the non-matching generation's `.cact` is rejected at `needle_load` with an honest `needle_last_error()` message.

## Canonical ADRs (docs/adr/)

- **0001** — Unified Agents and explicit tool binding (`docs/adr/0001-unified-agents-and-explicit-tool-binding.md`)
- **0002** — Google Workspace tools and auto-refresh propagation (`docs/adr/0002-google-workspace-tools-and-auto-refresh-propagation.md`)
- **0003** — Agent database schema evolution (`docs/adr/0003-agent-database-schema-evolution.md`)

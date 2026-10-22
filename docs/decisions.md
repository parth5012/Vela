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

### 2026-10-22: On-Device AI — Target Device Tier & 6 GB RAM Floor

- **Status**: Accepted
- **Context**: On-device MiniCPM5-2B inference requires sufficient RAM for Android OS (~2.5-3 GB), quantized model weights (~1.2-1.5 GB), and KV cache + runtime overhead (~0.5-1 GB).
- **Decision**: Minimum 6 GB RAM floor for local on-device execution. Devices with < 6 GB RAM are classified as `UNSUPPORTED` for local inference and automatically route to cloud gateway.
- **Consequences**: Protects against Android Low Memory Killer (LMK) process termination while covering mainstream mid-range devices (Pixel 6a+, Galaxy A54+, Nothing Phone).

### 2026-10-22: On-Device AI — Model Download Source, Network Policy & Storage Gate

- **Status**: Accepted
- **Context**: The quantized MiniCPM5-2B model artifact is ~1.2-1.5 GB in size.
- **Decision**: Model download URLs are retrieved dynamically from remote config/backend (never hardcoded in client). Downloads default to Wi-Fi only (with explicit user opt-in toggle for cellular). Pre-flight check requires >= 3 GB free storage before initiating download, and artifact SHA-256 checksum is verified before mounting.
- **Consequences**: Avoids accidental user data overages, prevents storage exhaustion crashes, and guarantees file integrity.

### 2026-10-22: On-Device AI — Low-RAM Runtime Degradation & Cloud Fallback

- **Status**: Accepted
- **Context**: Even on 6 GB+ devices, system memory pressure can fluctuate during active multitasking.
- **Decision**: Two-tier graceful degradation strategy: (1) Under moderate memory warnings, prune KV cache context window from 4096 to 1024 tokens; (2) If `TRIM_MEMORY_RUNNING_CRITICAL` is received from the OS, halt local inference and fallback to cloud execution with a user notification.
- **Consequences**: Keeps the application responsive without triggering OS process kills.

### 2026-10-22: On-Device AI — Cloud Fallback Policy & Privacy Disclosure

- **Status**: Accepted
- **Context**: When on-device execution cannot proceed (model not downloaded, low RAM, or unsupported hardware), requests may route to remote servers.
- **Decision**: Opt-in cloud fallback with prominent visual indication (a distinct "Cloud Fallback" badge/pill on message turns). Privacy copy explicitly guarantees encrypted transport, zero logging, and no training on user prompts.
- **Consequences**: High transparency for privacy-conscious users with graceful service continuity.

### 2026-10-22: On-Device AI — Tool-Calling Scope & Security Consent Gates for v0

- **Status**: Accepted
- **Context**: On-device AI needs tool capabilities to act as an assistant without introducing prompt injection or unintended device modification risks.
- **Decision**: Scope for v0: Alarms, Calendar, Messages, Clipboard. Read actions gated by standard Android runtime OS permissions; Write/Mutating actions require an explicit user confirmation dialog (deny-by-default); Hard cap of maximum 3 tool executions per turn.
- **Consequences**: Prevents unprompted modifications to user device data while enabling safe practical utility.

### 2026-10-22: On-Device AI — Voice Stack Direction for v1 (Bridge Pipeline)

- **Status**: Accepted
- **Context**: Adding voice interaction to Vela on mobile.
- **Decision**: Commit to the Bridge Pipeline for v1: Android SpeechRecognizer / local STT -> local MiniCPM5-2B -> Android TextToSpeech / system TTS. Target latency < 2s total turn time on mid-range phones. Defer tokenizer-free TTS (VoxCPM2) and omni full-duplex models (MiniCPM-o 4.5) to v2 flagship tiers.
- **Consequences**: Achieves reliable, low-latency, battery-conscious voice experience immediately without requiring flagship NPU hardware.

### 2026-10-22: On-Device AI — Voice Lane Architecture & Latency SLA (WF-03)

- **Status**: Accepted
- **Context**: Rigorous evaluation of the three voice lanes (Bridge, Polish/VoxCPM2, Omni/MiniCPM-o 4.5) from WF-08 against the 6 GB RAM floor constraint and latency SLA.
- **Decision**:
  1. **v1 Architecture**: Commit to **Lane 1 (Bridge Pipeline)** completely on-device (STT: Android SpeechRecognizer/vela-whisper; LLM: MiniCPM5-2B LiteRT INT4; TTS: System TTS/Piper).
  2. **Latency Budget SLA**: STT <= 250 ms, LLM TTFT & first chunk <= 350 ms, TTS <= 200 ms, total turn latency <= 1200 ms (sub-2s budget), active RAM <= 2.1 GB.
  3. **Flagship / v2 Direction**: Roadmap **Lane 3 (MiniCPM-o 4.5)** via OpenBMB Cloud API (WebSocket 16 kHz PCM streaming) or local on-device inference on flagship devices with >= 16 GB unified RAM.
  4. **Cloud Privacy Disclosure Copy**: Any remote audio processing requires explicit opt-in with user consent copy: `"Voice audio will be securely streamed to OpenBMB Cloud API solely for real-time transcription and generation. Audio is processed transiently in memory, never logged, and never used for model training."`
  5. **Child Tickets Groomed for Phase 3**: WF-V01 (Local STT integration), WF-V02 (Streaming chunking & barge-in), WF-V03 (System TTS & UI visualizer), WF-V04 (MiniCPM-o 4.5 Cloud API client).
- **Consequences**: Guarantees snappy, battery-efficient on-device voice turns without risking LMK process kills on 6 GB devices while establishing a clear upgrade path for flagship conversational omni-modality.

## Canonical ADRs (docs/adr/)

- **0001** — Unified Agents and explicit tool binding (`docs/adr/0001-unified-agents-and-explicit-tool-binding.md`)
- **0002** — Google Workspace tools and auto-refresh propagation (`docs/adr/0002-google-workspace-tools-and-auto-refresh-propagation.md`)
- **0003** — Agent database schema evolution (`docs/adr/0003-agent-database-schema-evolution.md`)

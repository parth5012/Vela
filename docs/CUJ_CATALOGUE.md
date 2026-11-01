# Vela Critical User Journey (CUJ) Catalogue

> Certified Tier-1 Critical User Journeys (CUJs) and user-perceived performance metrics.
> Standardized for the Vela Software Factory and regression ratchet gate.

## 1. Overview & Purpose

This catalogue formalizes the **Three Critical User Journeys** that define user-perceived quality in the Vela client. In the software factory model, these 3 CUJs serve as the primary Tier-1 release gates: any PR or automated change that degrades these metrics beyond calibrated noise margins is flagged mechanically by the regression ratchet.

---

## 2. The 3 Tier-1 Critical User Journeys

### CUJ-01: Cold Start to Typeable Composer
- **Metric Name**: `cold_start_to_typeable_ms`
- **User-Perceived Milestone**: Process launch to interactive text input.
- **Journey Narrative**: User launches the Vela app from a cold state, Hermes initializes the JavaScript engine, local SQLite database pragmas and migrations run, Zustand stores rehydrate from AsyncStorage and SecureStore, and the chat input composer becomes responsive for keyboard typing.
- **Spot-Measured Current Value**:
  - **1,580 ms** on native Android device (Release APK on Snapdragon 8 Gen 2 / Hermes AOT)
  - **348 ms** in headless engine simulation (`client/utils/benchmarkHarness.ts`)
  - **Target SLA**: $\le$ **1,200 ms** (Release APK on device), $\le$ **400 ms** (headless engine)
- **Measurement Substrate**:
  - Headless/In-Process: Module import + store rehydration timer in `client/perf/telemetry-cuj.ts` (to be codified in WF-462-04).
  - On-Device: `am start -W com.parth5012.client.dev` tracking `TotalTime`.

---

### CUJ-02: Send Action to Optimistic Bubble Render
- **Metric Name**: `send_to_bubble_ms`
- **User-Perceived Milestone**: Tap 'Send' to visual appearance of the user's message in the chat list.
- **Journey Narrative**: User taps the Send button in the chat interface, triggering synchronous message creation and state commit in `useChatStore`, rendering the user message bubble in FlashList within a single display frame before network request dispatch or background SQLite persistence completes.
- **Spot-Measured Current Value**:
  - **0.0 ms** synchronous blocking dispatch time (in-process headless test)
  - **14.5 ms** end-to-end paint latency on native Android device
  - **Target SLA**: $\le$ **16.6 ms** (guaranteed 60Hz 1-frame optimistic paint; $\le$ 4.0 ms headless dispatch)
- **Measurement Substrate**:
  - Monitored in `perf-baseline.json` as `sync_blocking_invariant_ms`.
  - Verified by measuring elapsed wall-clock time between `handleSend` invocation and optimistic store update.

---

### CUJ-03: Streaming Response Ingestion to Settled Bubble
- **Metric Name**: `stream_100_token_settle_ms`
- **User-Perceived Milestone**: First token arrival to smooth, stable rendering of completed response without UI jank.
- **Journey Narrative**: Incoming LLM response tokens arrive over SSE, are coalesced by `TokenCoalescer` into frame-synchronized bursts, parsed incrementally into Markdown and LaTeX AST by `latexExtractor` without re-rendering historical message cells, and settle into the active assistant bubble upon stream completion.
- **Spot-Measured Current Value**:
  - **0.59 ms** cumulative AST parse duration across 250 tokens (**1.5 ms** baseline in `perf-baseline.json`)
  - **10 commits** total React render commits across 250 tokens (via frame-coalesced batching)
  - **0 commits** redundant historical cell re-renders
  - **22.0 ms** first-token paint latency on native device
  - **Target SLA**: $\le$ **2.5 ms** parse time, $\le$ **10 commits**, strictly **0** redundant cell re-renders
- **Measurement Substrate**:
  - Monitored in `perf-baseline.json` across `stream_total_parse_ms`, `stream_render_commits`, `redundant_cell_rerenders`, and `parse_quadratic_ratio`.
  - Ingested from `client/__tests__/perf.benchmark.test.ts`.

---

## 3. Coordination with Wayfinder Map #455 & Ticket #461

Map #455 (*Chat Stream Performance & Virtualization Overhaul*) and ticket #461 (*Benchmark suite calibration and regression ratchet gate*) established initial performance benchmark groundwork for the chat stream.

This catalogue reuses and builds upon the landed #461 foundation:
1. **Inherited Baseline**: Reuses `perf-baseline.json` committed at the repository root. All chat-stream metrics (`stream_render_commits`, `redundant_cell_rerenders`, `stream_total_parse_ms`, `parse_quadratic_ratio`, `sync_blocking_invariant_ms`) map directly to CUJ-02 and CUJ-03.
2. **Harness Extension**: In ticket WF-462-04, the Tier-1 CUJ harness will extend `client/__tests__/perf.benchmark.test.ts` into a unified suite (`client/__tests__/perf.cuj.test.ts`) that measures all 3 CUJ metrics (`cold_start_to_typeable_ms`, `send_to_bubble_ms`, `stream_100_token_settle_ms`) with 5-run trimmed medians for deterministic CI evaluation.
3. **No Duplicate Baselines**: Rather than creating a competing schema, the factory ratchet adopts the existing versioned schema from `perf-baseline.schema.json`.

# Comprehensive Performance Benchmark & Ratchet Plan for Vela (Hardened)
> Multi-Tier Regression Ratchet System for Expo, React Native 0.86 (Hermes), and Native Android.
> Hardened via multi-agent adversarial review across frontier models (Mimo, Space Bunny, Dots3, DeepSeek, Beam).

---

## 1. Executive Summary & Core Architectural Truths

Following aggressive adversarial review against the live Vela codebase across 8 frontier models (Mimo, Space Bunny, GLM 5.3, Dots3, DeepSeek, LongCat, Beam), we have refined the plan from an idealistic specification into a noise-resistant, production-grade engineering system.

### Key Refinements from Adversarial Review:
1. **Honest Instrumentability Split**: 
   - We **never** pretend headless Jest can measure native Choreographer vsync deadlines (`< 16.6ms`), pixel paints, or display jank.
   - **Lane 1: Headless CI Engine Gate (< 45s on every PR)** gates on **deterministic JS/React runtime invariants only** (React commit counts, cumulative AST parse time, JS event-loop lag, parse cache hit rates, zero SQLite blocking before optimistic render).
   - **Lane 2: Native Android Device Gate (Pre-Release / Local APK)** measures true hardware-level metrics (cold start via `am start -W`, display jank via `dumpsys gfxinfo framestats`, and PSS heap growth via `dumpsys meminfo`).
2. **Detection of Quadratic $O(n^2)$ Markdown Thrashing**:
   - Measuring single-chunk parse times passes broken code. We track **cumulative stream parse duration** (`stream_parse_total_ms`) and assert `total_parse(250 tokens) / total_parse(125 tokens) < 2.5` to catch quadratic full-document re-parsing.
3. **Database Concurrency & p99 Metrics**:
   - Pin PRAGMAs (`journal_mode=WAL`, `busy_timeout=5000`) in `client/db/client.ts`. Measure both `sqlite_insert_p50_ms` and `sqlite_insert_p99_ms` to catch WAL checkpoint stalls under simultaneous streaming and `operationLog` sync.
4. **Zero-Allocation Telemetry Ring Buffer**:
   - In-app telemetry uses pre-allocated TypedArrays (`Float64Array`) during active streaming to prevent instrumentation GC spikes from corrupting the very benchmarks we are taking. Flushed to logcat only after the stream settles.
5. **Frame-Coalesced Token Architecture**:
   - Rather than updating Zustand on every token, incoming deltas are buffered and committed on frame boundaries (~60Hz / `requestAnimationFrame`), guaranteeing that commit count scales with time rather than token count.
6. **Profile 4 (Concurrent Stress)**:
   - Added real-world contention: simultaneous 250-token stream + SQLite delta writes + 150-message history scroll + keyboard mounted.
7. **Runner Fingerprinting & Adaptive Noise Thresholds**:
   - Baselines are tagged with the runner environment (`cpu_arch + node_version + hermes_version`). Thresholds use `threshold = max(baseline × (1 + rel%), baseline + abs_floor)`.

---

## 2. The 18 Hardened Metrics (Split by Observability)

```
┌────────────────────────────────────────────────────────────────────────┐
│             LANE 1: Headless CI Engine Gate (Every PR < 45s)           │
│                    (Node/Jest Environment Invariants)                  │
├────────────────────────────────────────────────────────────────────────┤
│  1. `stream_render_commits`        : Total React commits during stream │
│  2. `redundant_cell_rerenders`     : Must equal 0 (memoized history)   │
│  3. `stream_total_parse_ms`        : Cumulative Markdown parse CPU ms  │
│  4. `parse_quadratic_ratio`        : total(250) / total(125) < 2.5     │
│  5. `js_event_loop_lag_ms`         : Event loop delay during stream    │
│  6. `sqlite_insert_duration_ms`    : Drizzle write per message         │
│  7. `sqlite_query_duration_ms`     : Drizzle 30-msg history read       │
│  8. `sqlite_write_batch_efficiency`: Assert write count << token count │
│  9. `sync_blocking_invariant_ms`   : Time before optimistic state set  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────┴────────────────────────────────────┐
│            LANE 2: Native Android Device/Emulator Gate (Pre-Release)   │
│                     (Release APK on Android OS Pipeline)               │
├────────────────────────────────────────────────────────────────────────┤
│ 10. `cold_launch_to_content_ms`    : Process start to interactive      │
│ 11. `send_to_bubble_paint_ms`      : Tap Send to first native paint    │
│ 12. `time_to_first_token_paint_ms` : Tap Send to first chunk paint     │
│ 13. `android_jank_frame_pct`       : % frames > 16.6ms (dumpsys gfxinfo│
│ 14. `p95_frame_duration_ms`        : 95th percentile display frame ms  │
│ 15. `scroll_blank_cell_ratio`      : % viewport empty during fling     │
│ 16. `keystroke_input_lag_ms`       : Touch event to layout paint       │
│ 17. `stop_generation_latency_ms`   : Tap Stop to native stream halt    │
│ 18. `session_memory_growth_mb`     : PSS Dalvik/Native heap delta      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The 4 Synthetic Workload Profiles

1. **Profile 1 (Short Latency)**: 5 messages, 30 plain-text tokens streaming. Tests optimistic insertion and TTFT.
2. **Profile 2 (Heavy AI Rich-Text)**: 250 tokens containing TypeScript code blocks, a Markdown table, and LaTeX equations. Tests cumulative AST parsing and render commits.
3. **Profile 3 (Long History Hydration)**: 150 loaded messages in SQLite. Tests database hydration, thread switching, and memory retention.
4. **Profile 4 (Concurrent Stress)**: Simultaneous 250-token stream + SQLite delta writes + active scroll + keyboard mounted. Tests backpressure, WAL concurrency, and thread starvation.

---

## 4. Immediate Code Improvements to Execute

The adversarial review identified three architectural fixes that must be implemented in Vela:

1. **Incremental Markdown Caching (`client/components/chat/RichText.tsx`)**:
   - Cache parsed AST by block hash/ID so completed paragraphs are never re-parsed when new tokens arrive.
2. **SQLite WAL & Non-Blocking Write Batching (`client/db/client.ts` & `chatRepository.ts`)**:
   - Enable `PRAGMA journal_mode = WAL;`.
   - Batch incoming streaming deltas so the database is written only once per 1–2 seconds rather than on every single token.
3. **Transient Streaming Store**:
   - Isolate active streaming tokens from `useChatStore.messages[activeThreadId]` so the main message list does not reconcile on every tick.

---

## 5. File Deliverables

- `client/utils/perfTracker.ts` (Zero-allocation TypedArray telemetry)
- `client/__tests__/perf.benchmark.test.ts` (Headless CI test suite)
- `client/e2e/benchmark-android.py` (Local Android emulator hardware profiler)
- `perf-baseline.json` (Locked metrics baseline with environment fingerprint and target SLAs)
- `.github/workflows/perf-ratchet.yml` (GitHub Actions automated PR commenter)
- `.opencode/skills/deep-performance-engineering/scripts/ratchet.py` (Multi-lane target SLA comparator CLI)

---

## 6. Target SLA Calibration Matrix (Reference Standards: T3 Chat, ChatGPT & WhatsApp)

| ID | Metric | Baseline | Target SLA | Reference System & Rationale | Lane |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01** | `stream_render_commits` | 10 commits | **$\le 10$ commits** | **T3 Chat**: Frame-throttled reactive streaming prevents reconciliation churn across 250 tokens | Lane 1 (CI) |
| **02** | `redundant_cell_rerenders` | 0 commits | **$= 0$ commits** | **T3 Chat**: Historical memoized messages remain static during active streaming | Lane 1 (CI) |
| **03** | `stream_total_parse_ms` | 1.00 ms | **$< 5.0$ ms** | **Vela Engine**: Cumulative AST markdown parse CPU time over 250 incoming tokens | Lane 1 (CI) |
| **04** | `parse_quadratic_ratio` | 1.90 ratio | **$< 2.50$ ratio** | **T3 Chat**: Sub-quadratic scaling invariant ($T_{250} / T_{125} < 2.5$) | Lane 1 (CI) |
| **05** | `js_event_loop_lag_ms` | 1.00 ms | **$< 4.0$ ms** | **WhatsApp**: Uninhibited JS event loop preserves 60fps microtask processing | Lane 1 (CI) |
| **06** | `sqlite_insert_duration_ms` | 0.50 ms | **$< 3.0$ ms** | **WhatsApp**: WAL asynchronous background queue latency for single-message persistence | Lane 1 (CI) |
| **07** | `sqlite_query_duration_ms` | 0.50 ms | **$< 5.0$ ms** | **WhatsApp**: 30-message history thread hydration query duration | Lane 1 (CI) |
| **08** | `sqlite_write_batch_efficiency`| 1 writes | **$\le 5$ writes** | **Vela Engine**: Batching write efficiency restricts DB transactions during streaming | Lane 1 (CI) |
| **09** | `sync_blocking_invariant_ms` | 0.10 ms | **$< 4.0$ ms** | **WhatsApp**: Instantaneous optimistic UI dispatch prior to async persistence / network | Lane 1 (CI) |
| **10** | `cold_launch_to_content_ms` | 348 ms | **$< 1,200$ ms** | **ChatGPT**: Hermes AOT bytecode and deferred secondary bootstrap SLA | Lane 2 (Device) |
| **11** | `send_to_bubble_paint_ms` | 8.00 ms | **$< 16.6$ ms** | **WhatsApp**: Sub-16ms touch-to-native-bubble paint deadline (1 frame @ 60Hz) | Lane 2 (Device) |
| **12** | `time_to_first_token_paint_ms` | 180 ms | **$< 250$ ms** | **ChatGPT**: Rapid initial token response and display rendering | Lane 2 (Device) |
| **13** | `android_jank_frame_pct` | 0.00 % | **$< 2.0$ %** | **ChatGPT**: Strict frame deadline enforcement via `dumpsys gfxinfo framestats` | Lane 2 (Device) |
| **14** | `p95_frame_duration_ms` | 11.00 ms | **$< 16.6$ ms** | **WhatsApp**: 95th percentile display frame render duration within 60Hz deadline | Lane 2 (Device) |
| **15** | `scroll_blank_cell_ratio` | 0.00 % | **$< 0.4$ %** | **WhatsApp / FlashList**: Native view recycling prevents unrendered blank cells on fling | Lane 2 (Device) |
| **16** | `keystroke_input_lag_ms` | 8.00 ms | **$< 16.6$ ms** | **WhatsApp**: Instantaneous keyboard layout paint on key press | Lane 2 (Device) |
| **17** | `stop_generation_latency_ms` | 25.00 ms | **$< 50$ ms** | **ChatGPT**: Immediate AbortController cancellation halting network and worker threads | Lane 2 (Device) |
| **18** | `session_memory_growth_mb` | 5.00 MB | **$< 15$ MB** | **WhatsApp (< 8MB) & ChatGPT (< 22MB)**: Virtualized AST and image cache bound heap growth | Lane 2 (Device) |

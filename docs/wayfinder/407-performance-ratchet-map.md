# Wayfinder 407 — Deep Performance Benchmarks & Regression Ratchets (18 Metrics)

Map: [#407 Wayfinder map: Deep Performance Benchmarks & Regression Ratchets (18 Metrics)](https://github.com/parth5012/Vela/issues/407)

Child Tickets:
- [#408 In-App Zero-Allocation Telemetry & Ring Buffer](https://github.com/parth5012/Vela/issues/408)
- [#409 SQLite WAL Configuration & Non-Blocking Write Batching](https://github.com/parth5012/Vela/issues/409)
- [#410 Incremental Block Markdown AST Caching](https://github.com/parth5012/Vela/issues/410)
- [#411 Headless CI Engine Benchmark Suite](https://github.com/parth5012/Vela/issues/411)
- [#412 Local Native Android Frame & Memory Profiler](https://github.com/parth5012/Vela/issues/412)
- [#413 GitHub Actions PR Ratchet Workflow](https://github.com/parth5012/Vela/issues/413)

---

## 1. Destination

Implement a comprehensive 18-metric performance benchmarking, telemetry, and automated regression ratchet system for Vela (Expo / React Native 0.86 / Hermes / Android). Includes the zero-allocation telemetry engine, incremental Markdown parsing, SQLite WAL write batching, headless CI engine gate (<45s on PRs), and local Android hardware profiler.

## 2. Adversarial Hardening Rules (Multi-Model Consensus)

1. **No Headless Illusion**: Headless Jest runs on Node/V8 and never pretends to measure native vsync frame deadlines (<16.6ms) or pixel paint. Headless CI gates on deterministic JS runtime invariants only (React commit counts, AST parse duration, JS event loop lag, parse cache hit rates).
2. **Quadratic O(n²) Thrashing Detection**: Measure cumulative AST parse time across streaming (`stream_parse_total_ms`) and assert `total_parse(250 tokens) / total_parse(125 tokens) < 2.5` to catch full-document re-parsing.
3. **Zero-Allocation Telemetry**: During active streaming, in-app telemetry buffers timestamps in pre-allocated `Float64Array` typed arrays, preventing instrumentation GC spikes from corrupting the benchmark.
4. **Database Concurrency & P99**: Configure SQLite with `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;`. Measure both `sqlite_insert_p50_ms` and `sqlite_insert_p99_ms` to catch write lock contention between streaming saves and `operationLog` sync.
5. **Runner Fingerprinting**: Baselines are tagged with runner environment (`cpu_arch + node_version + hermes_version`). Thresholds use `max(baseline * (1 + rel%), baseline + abs_floor)` to avoid false-alarm failures on shared CI VMs.

## 3. Dependency DAG

```
#408 (Telemetry & Ring Buffer) ──────────────┐
                                             ├──> #411 (Headless CI Benchmark) ──> #413 (CI PR Ratchet)
#409 (SQLite WAL & Write Batching) ──────────┤
                                             │
#410 (Incremental Markdown AST Cache) ───────┘

#408 (Telemetry & Ring Buffer) ──────────────> #412 (Local Android Profiler)
```

## 4. Execution via Autonomous Agents (Handover)

To run this entire map AFK with an autonomous agent:
```bash
/wayfinder-runner 407
```
Or dispatch sequentially with `CoderAgent` starting from tickets #408, #409, #410 in parallel, then #411, #412, and #413.

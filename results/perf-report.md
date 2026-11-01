# Performance Ratchet Benchmark Report

Generated: 2026-10-31T08:52:05.730Z
Runtime: Node v26.8.2 / Jest on linux

| Metric | Value | Target | Status |
|---|---:|---:|:---:|
| stream_render_commits | 10 commits | 10 | PASS |
| redundant_cell_rerenders | 0 commits | 0 | PASS |
| stream_total_parse_ms | 1.05 ms | 2.5 | PASS |
| parse_quadratic_ratio | 1.46 ratio | 2.2 | PASS |
| js_event_loop_lag_ms | 0 ms | 4 | PASS |
| sqlite_insert_duration_ms | 1 ms | 3 | PASS |
| sqlite_query_duration_ms | 1 ms | 5 | PASS |
| sqlite_write_batch_efficiency | 1 writes | 5 | PASS |
| sync_blocking_invariant_ms | 0 ms | 4 | PASS |

**Result:** 9/9 metrics within target.

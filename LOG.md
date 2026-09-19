# Log

> Every iteration logged with status, what changed, and verification result.

## Format

Each entry:

- **Date**: YYYY-MM-DD HH:MM
- **Status**: Done | Blocked | Budget | Compacted | Stuck | Outage | Review
- **What**: Brief description of the task/change
- **Verified**: What was run to verify (tests, typecheck, etc.)
- **Notes**: Any decisions or learnings

## Entries

| Date | Status | What | Verified | Notes |
|------|--------|------|----------|-------|
| 2026-09-19 07:45 | Done | Resolved Ticket #274: Golden grading, CI wiring, ADR and glossary (Map #265 destination achieved!) | 88 Pytest tests passed in backend/tests/test_golden.py | Added OpenRouter judge, nightly CI workflow, ADR-0004, and CONTEXT.md glossary on branch eval/grading-docs |
| 2026-09-19 07:35 | Done | Resolved Ticket #273: Golden cases: tool and infra failures (10) (part of Map #265) | 88 Pytest tests passed in backend/tests/test_golden.py | Appended tools_001..tools_010 to backend/evals/golden.jsonl, added hallucinated citation negative test on branch eval/tool-cases |
| 2026-09-19 07:25 | Done | Resolved Ticket #272: Golden cases: Android SSE streaming regressions (10) (part of Map #265) | 79 Pytest tests passed in test_golden.py + test_sse_concurrency.py | Appended sse_001..sse_010 to backend/evals/golden.jsonl, added missing done negative test on branch eval/sse-cases |
| 2026-09-19 07:15 | Done | Resolved Ticket #271: Golden cases: hostile, forgery, multilingual inputs (10) (part of Map #265) | 66 Pytest tests passed in backend/tests/test_golden.py | Appended hostile_001..hostile_010 to backend/evals/golden.jsonl, added XML forgery negative test on branch eval/hostile-cases |
| 2026-09-19 07:05 | Done | Resolved Ticket #270: Golden cases: multi-turn skill interruptions (10) (part of Map #265) | 55 Pytest tests passed in backend/tests/test_golden.py | Appended skill_001..skill_010 to backend/evals/golden.jsonl, added stop-handler negative test on branch eval/skill-cases |
| 2026-09-19 06:55 | Done | Resolved Ticket #269: Golden cases: memory isolation + recall (10) (part of Map #265) | 44 Pytest tests passed in backend/tests/test_golden.py | Appended memory_001..memory_010 to backend/evals/golden.jsonl, added thread leak negative test on branch eval/memory-cases |
| 2026-09-19 06:45 | Done | Resolved Ticket #268: Golden cases: auth-gate + OAuth refresh (10) (part of Map #265) | 38 Pytest tests passed in test_golden.py + test_auth_gate.py | Appended auth_001..auth_010 to backend/evals/golden.jsonl, added negative redirect assertion test on branch eval/auth-cases |
| 2026-09-19 06:35 | Done | Resolved Ticket #267: Golden cases: routing ambiguity (10) (part of Map #265) | 23 Pytest tests in backend/tests/test_golden.py passed (12 golden cases + negative flip tests + malformed fixture tests) | Appended route_001..route_010 to backend/evals/golden.jsonl, enhanced validate_sse.py regex, on branch eval/route-cases |
| 2026-09-19 06:25 | Done | Resolved Ticket #266: Golden schema + harness + SSE validator (part of Map #265) | 9 Pytest tests in backend/tests/test_golden.py passed (dual-oracle supervisor routes + SSE contract + malformed fixture assertions) | Implemented backend/evals/validate_sse.py, golden.jsonl (v1), README.md, test_golden.py on branch eval/schema-harness |
| 2026-09-07 13:40 | Done | Resolved Wayfinder Map #222: Cactus Needle & Custom Local Models Subsystem (#223-#229) | 37 Jest client tests in 8 suites, 12 Pytest backend tests in 3 suites | Full autonomous AFK loop: Expo Needle module, JNI bridge, custom model storage, RAM gating, local agent loop, sync queue, and E2E harness |
| —    | —      | —    | —        | —     |

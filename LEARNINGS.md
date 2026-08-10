# Learnings

> Key learnings, edge cases, and concepts worth remembering for this project.

## Project-Specific Learnings

- Vela is a single-tenant (one Owner) personal assistant: Telegram, Discord, and an Expo/React Native Android client all talk to one FastAPI backend.
- Backend runtime is Python 3.11+ managed by `uv` (see `backend/pyproject.toml`). Run everything through `uv run`, never bare `python`.
- The supervisor pattern uses LangGraph; intents are classified in `agent/router.py` and routed to tools or multi-turn skills (`agent/graph.py`).
- Memory is server-side and semantic: Supabase PostgreSQL + pgvector, 512-dim embeddings (`backend/db/supabase.py`, `db/schema.sql`).
- Client is a single Expo project under `client/` (not a monorepo). No lint/format scripts configured there — typecheck via `npx tsc --noEmit`.
- The ADB-connected device is the user's personal phone (MIUI). `adb shell input` is blocked, so UI automation is not an option; prefer read-only inspection.

## Decision Log

> Why decisions were made, alternatives considered, and consequences.

_None yet — populate as the agent discovers patterns, edge cases, and gotchas._

## Edge Cases

> Known edge cases, gotchas, and non-obvious behaviors discovered during work.

_None yet._

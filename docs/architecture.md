# Architecture

> Documented from the graphify knowledge graph (`graphify-out/graph.json`) and source inspection, 2026-08-10.

## Overview

Vela is a **single-tenant, self-hosted personal assistant backend** (FastAPI + LangGraph) serving one Owner across three channels: Telegram, Discord, and an Expo/React Native Android client. A **Supervisor Agent Pattern** classifies intents and routes them to tools or multi-turn skills, backed by server-side semantic memory (Supabase pgvector).

## Project Structure

```
Vela/
├── backend/                 # Python backend (uv-managed, pyproject.toml)
│   ├── agent/               # FastAPI app, LangGraph supervisor graph, routing, memory, self-improve
│   ├── db/                  # SQLAlchemy models, sessions, Supabase/pgvector wrapper, schema.sql
│   ├── tools/               # Tool bindings: web_search, code_exec, gmail, calendar, memory, status, webview_browser
│   ├── skills/              # Multi-turn skills (base, brainstorming, research, coding)
│   ├── gateway/             # Channel gateways: telegram, discord, carbonvoice
│   ├── cron/                # Nightly self-improvement / consolidation loop, health checks
│   ├── utils/               # auth_gate, llm, logger, ulid, helpers, google_drive
│   ├── scripts/             # setup_check.py, deploy tooling
│   └── tests/               # pytest suite (24 files, pytest-asyncio)
├── client/                  # Expo / React Native app (single project, not monorepo)
│   ├── app/                 # expo-router screens (index, settings, setup, _layout)
│   ├── components/          # chat + ui components
│   ├── store/               # Zustand stores (useChatStore, useConfigStore, useBrowserStore, useGoogleAuthStore)
│   ├── utils/               # sse, toolProxy, messageParser, localLlm, history, sourceParser
│   ├── db/                  # drizzle-orm + expo-sqlite local db
│   └── __tests__/           # Jest (jest-expo preset)
├── docs/                    # adr/, agents/, superpowers/ (plans & specs)
├── CONTEXT.md               # Single-context domain model (glossary)
├── graphify-out/            # Knowledge graph artifacts (see below)
└── render.yaml              # Render Blueprint deployment
```

## Key Modules & Responsibilities

| Module | Responsibility |
|--------|----------------|
| `agent/main.py` | FastAPI app; lifespan, REST + SSE endpoints, OAuth callbacks, webhook receivers (Telegram, CarbonVoice) |
| `agent/graph.py` | LangGraph supervisor workflow definition (nodes: agent, router, memory, tools) |
| `agent/router.py` | Intent classification / routing node in the supervisor graph |
| `agent/state.py` | Shared graph state schema |
| `agent/registry.py` | Agent definitions & explicit tool bindings (Agent Tool Registry) |
| `agent/persona.py` / `prompt.py` / `prompt_history.py` | Prompt assembly, personas, history |
| `agent/concurrency.py` | Async concurrency / throttling helpers |
| `db/supabase.py` | Supabase DB wrapper with pgvector semantic search |
| `db/session.py` | SQLAlchemy engine + thread-safe sessions |
| `db/models.py` | ORM models (Conversations, Experiences, OAuthTokens, memory vectors, skills registry) |
| `tools/*.py` | Individual tool bindings (web search, E2B code exec, Gmail, Calendar, memory, webview browser, status) |
| `skills/base.py` + skills | Abstract base + multi-turn skill implementations |
| `gateway/telegram.py` | Telegram webhook update parser/receiver |
| `gateway/discord.py` | Discord event-driven bot (prefixed commands `v.`) |
| `gateway/carbonvoice.py` | CarbonVoice gateway (voice) |
| `cron/consolidate.py` | Nightly self-improvement loop (evaluates experiences, refines system prompts) |
| `cron/health.py` | Keep-alive health check |
| `utils/auth_gate.py` | Authentication Gate for Google Workspace tools (OAuth check → redirect URL) |

## Data Flow

1. **Ingress** — a message arrives via a gateway: Telegram webhook (`POST /webhooks/telegram`), Discord bot event, CarbonVoice webhook, or the mobile client (`POST /chat/message`).
2. **Auth** — external/mobile requests require `Authorization: Bearer <VELA_API_KEY>`. Google Workspace tools pass the Authentication Gate (`utils/auth_gate.py`), reading saved OAuth tokens for the Conversation and aborting with a redirect URL if missing.
3. **Supervisor graph** — `agent/graph.py` orchestrates: memory retrieval (pgvector semantic search) → intent classification (`agent/router.py`) → routing to a tool or a multi-turn skill (`skills/*`) → LLM response via the active Agent's prompt & tool bindings.
4. **Persistence** — conversation history and experiences written via `db/` (SQLAlchemy → Supabase Postgres). OAuth tokens auto-refreshed and written back.
5. **Response** — streamed to the client as SSE chunks (`data: {"type": "content", ...}` then `data: {"type": "done", ...}`).
6. **Self-improvement** — nightly `cron/consolidate.py` evaluates recent Experiences and refines system prompt fragments stored in the DB.

## External Dependencies & Integrations

- **Supabase** (PostgreSQL + pgvector, 512-dim embeddings)
- **Google Workspace** — Gmail + Google Calendar via OAuth (auto-refresh propagation)
- **Gemini LLM** (`GOOGLE_API_KEY`) as primary reasoning model; LangChain providers Groq, OpenAI, Cohere, VoyageAI, OpenRouter for fallback
- **Tavily** web search
- **E2B** sandboxed code execution
- **Telegram** (`python-telegram-bot`), **Discord** (`discord.py`), **CarbonVoice** gateways
- **Render** (render.yaml Blueprint)

## Entry Points

- **Backend server**: `uv run uvicorn agent.main:app --reload` (from `backend/`, port 8000). Docs at `/docs`.
- **Health**: `GET /health` (Bearer auth)
- **Chat**: `GET /chat/threads`, `GET /chat/threads/{id}`, `POST /chat/message` (SSE), `POST /chat/threads`, `DELETE /chat/threads/{id}`, `POST /chat/threads/branch`, `POST /chat/threads/{id}/truncate`
- **OAuth**: `GET /oauth/google/authorize`, `GET /oauth/callback`, `POST /oauth/token`, `POST /oauth/token/revoke`, `GET /oauth/token/status`, `GET /oauth/login`
- **Webhooks**: `POST /webhooks/telegram`, `POST /webhooks/carbonvoice`, `POST /chat/webview/response`
- **Tools/Sync**: `GET /api/tools/manifest`, `POST /api/tools/invoke`, `GET /api/sync/pull`, `POST /api/sync/push`
- **Ops**: `POST /consolidate`
- **Client**: `npm start` (Expo dev server), `npm run android`
- **Setup check**: `uv run python scripts/setup_check.py`

## Commands

- **Backend tests**: `uv run python -m pytest -v` (run from `backend/`)
- **Backend deps**: `uv sync` (from `backend/`)
- **Client tests**: `npm test` (Jest)
- **Client typecheck**: `npx tsc --noEmit`
- **Client native**: `npx expo prebuild --clean`
- **Graph update**: `graphify update .` after modifying code

## Knowledge Graph

The project graph lives at **`graphify-out/graph.json`** (1271 nodes, 2009 edges, 97 communities; built from commit `202f0bf0`). Query with `graphify query "<question>"`, `graphify path "<A>" "<B>"`, `graphify explain "<concept>"`. Interactive view: `graphify-out/graph.html`. Broad architecture: `graphify-out/GRAPH_REPORT.md`. Rebuild/update with `graphify update .` (AST-only, no API cost).

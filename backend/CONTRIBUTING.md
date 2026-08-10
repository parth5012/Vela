# Contributing to Vela Backend

Thank you for your interest in contributing! This document will help you get the backend running locally and outline the conventions we follow.

---

## Table of Contents

- [Quick Start (Self-Hosting on Render)](#quick-start-self-hosting-on-render)
- [Local Development Setup](#local-development-setup)
- [Project Architecture](#project-architecture)
- [Development Workflow](#development-workflow)
- [Coding Conventions](#coding-conventions)
- [Testing](#testing)
- [Database Migrations](#database-migrations)
- [Submitting Changes](#submitting-changes)
- [Troubleshooting](#troubleshooting)

---

## Quick Start (Self-Hosting on Render)

This guide walks you through hosting your own Vela backend on [Render](https://render.com) and connecting it to the Vela Android client. The whole process takes about 15 minutes.

### Prerequisites

- A [GitHub](https://github.com) account (to fork this repo)
- A [Render](https://render.com) account (free tier works for testing)
- A [Supabase](https://supabase.com) account (free tier works)

### 1. Fork and Clone

```bash
git clone https://github.com/parth5012/Vela.git
cd Vela/backend
```

### 2. Set Up the Database (Supabase)

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → **New Query**
3. Open `backend/db/schema.sql` and paste its contents
4. Click **Run** — this creates all tables and enables `pgvector`
5. Go to **Settings → API** and copy:
   - **Project URL** → you'll need this for `SUPABASE_URL`
   - **service_role key** → you'll need this for `SUPABASE_SERVICE_ROLE_KEY`
6. Go to **Settings → Database → Connection string** and copy the `postgresql://` URI for `DATABASE_URL`

### 3. Deploy to Render

This repo includes a [`render.yaml`](../render.yaml) Blueprint for one-click deployment:

1. **Fork this repo** to your own GitHub account
2. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint Instance**
3. Connect your forked repo
4. Render will auto-detect `render.yaml` and create the web service
5. Fill in the environment variables when prompted:

| Variable | Value |
|----------|-------|
| `GOOGLE_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) (free Gemini API key) |
| `VELA_API_KEY` | Any secure random string — this is YOUR client auth token |
| `SUPABASE_URL` | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase → Settings → API |
| `DATABASE_URL` | From Supabase → Settings → Database |

6. Click **Deploy** — Render will install dependencies and start the server

> **Alternative: Manual Render setup** (without Blueprint)
> 1. Render Dashboard → **New** → **Web Service** → connect your repo
> 2. Set **Root Directory** to `backend`
> 3. Set **Build Command** to `uv sync --frozen`
> 4. Set **Start Command** to `uv run uvicorn agent.main:app --host 0.0.0.0 --port $PORT`
> 5. Add all environment variables from the table above
> 6. Choose **Starter** plan ($7/month — required for always-on; free tier sleeps after 15 min)

### 4. Verify Deployment

Once deployed, Render gives you a URL like `https://vela-backend.onrender.com`. Test it:

```bash
curl https://vela-backend.onrender.com/
# Expected: {"status":"ok"}
```

### 5. Connect the Android Client

1. Download the latest APK from [Vela Android Client Releases](https://github.com/parth5012/vela-android-client/releases)
2. Install it on your Android device
3. On first launch, enter:
   - **Server URL:** Your Render URL (e.g., `https://vela-backend.onrender.com`)
   - **API Key:** The `VELA_API_KEY` value you set in Render's environment

The app will verify the connection via `GET /health` and you're ready to go.

### 6. Configure Optional Features

After the basic setup works, you can add more capabilities by adding environment variables in Render:

| Variable | Feature Enabled |
|----------|----------------|
| `TAVILY_API_KEY` | Web search ([get key](https://tavily.com)) |
| `E2B_API_KEY` | Sandboxed code execution ([get key](https://e2b.dev)) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot gateway |
| `DISCORD_BOT_TOKEN` | Discord bot gateway |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Gmail/Calendar OAuth |

> **Note:** After adding env vars in Render, the service auto-redeploys. No need to redeploy manually.

### Render Plan Recommendation

| Plan | Cost | When to Use |
|------|------|-------------|
| **Free** | $0 | Testing only — sleeps after 15 min of inactivity, slow cold starts |
| **Starter** | $7/month | Production use — always on, reliable response times |

For a personal assistant you'll use daily, **Starter** is recommended to avoid cold-start delays.

---

## Local Development Setup

For contributors who want to modify the backend:

```bash
cd backend

# Install all dependencies including dev tools
uv sync --all-groups

# Set up pre-commit hooks (if available)
# pre-commit install

# Run the server with hot reload
uv run uvicorn agent.main:app --reload
```

### Environment Variables for Development

For local development, you can use a simplified `.env`:

```env
# === Required ===
GOOGLE_API_KEY=your_gemini_key
VELA_API_KEY=dev_key_change_me
DATABASE_URL=postgresql://your_user:your_password@your_host:5432/your_db?sslmode=require

# === Optional Supabase Configuration (if applicable) ===
# SUPABASE_URL=https://your_project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# === Optional (features disabled without these) ===
TAVILY_API_KEY=
E2B_API_KEY=
TELEGRAM_BOT_TOKEN=
DISCORD_BOT_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/oauth/callback
```

> **Tip:** Features degrade gracefully. Without `TAVILY_API_KEY`, web search is unavailable. Without Telegram/Discord tokens, those gateways stay offline.

---

## Project Architecture

```
backend/
├── agent/              # FastAPI app + LangGraph supervisor
│   ├── main.py         # REST endpoints, OAuth, webhooks, lifespan
│   ├── graph.py        # LangGraph state machine definition
│   ├── router.py       # Intent routing (tool vs skill)
│   ├── memory.py       # Semantic memory read/write
│   ├── self_improve.py # Evaluation + prompt refinement
│   ├── prompt_builder.py
│   ├── persona.py      # Persona definitions
│   └── registry.py     # Agent registry
├── db/                 # Database layer
│   ├── models.py       # SQLAlchemy ORM models
│   ├── session.py      # Engine + session factory
│   ├── client.py       # CRUD wrapper
│   ├── supabase.py     # Supabase proxy (routes through SQLAlchemy)
│   └── schema.sql      # Full database schema
├── tools/              # Tool implementations (Tavily, E2B, Gmail, Calendar, etc.)
├── skills/             # Multi-turn agentic skills (Brainstorm, Research, Coding)
├── gateway/            # Chat platform integrations (Telegram, Discord)
├── cron/               # Scheduled tasks (consolidation, health)
├── utils/              # Helpers (auth gate, LLM fallback, logger, ULID)
└── tests/              # pytest test suite
```

### Key Design Patterns

- **Supervisor Pattern:** `graph.py` defines a LangGraph state machine that routes incoming messages to either a tool or a multi-turn skill.
- **Auth Gate:** Tools requiring OAuth call `ensure_google_auth()` before execution. If no token exists, the agent returns an auth URL to the user.
- **LLM Fallback:** The system tries providers in order: Gemini → Groq → OpenRouter → Cohere. If one fails, it automatically falls back.

---

## Development Workflow

1. **Create a branch:** `git checkout -b feature/your-feature-name`
2. **Make changes** — see [Coding Conventions](#coding-conventions) below
3. **Run tests:** `uv run python -m pytest -v`
4. **Test manually:** Start the server and hit endpoints with curl or the Swagger UI at `/docs`
5. **Commit and push** — commit messages should be descriptive
6. **Open a Pull Request** against `main`

---

## Coding Conventions

### Python Style

- **Formatter:** We use `ruff` for both linting and formatting (when configured)
- **Type hints:** All function signatures should include type hints
- **Async first:** Use `async def` for I/O-bound operations (API calls, DB queries)
- **No comments unless necessary:** Code should be self-documenting. Use comments only for "why," not "what."

### Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `snake_case.py` | `web_search.py` |
| Classes | `PascalCase` | `SupabaseDB` |
| Functions | `snake_case` | `get_llm()` |
| Constants | `UPPER_SNAKE` | `PERSONA_LIST` |
| Private | `_leading_underscore` | `_internal_helper()` |

### Imports

Group imports in this order (enforced by ruff when configured):
1. Standard library
2. Third-party packages
3. Local modules

```python
import os
import asyncio
from typing import Optional

from fastapi import FastAPI, Depends
from sqlalchemy import create_engine

from db.session import get_db_session
from utils.logger import StructuredLogger
```

### Environment Variables

- Use `os.getenv("VAR_NAME", "default")` for optional vars with sensible defaults
- Use `os.getenv("VAR_NAME")` (returns `None`) for optional vars without defaults
- Raise `ValueError` at startup for required vars that are missing

---

## Testing

```bash
# Run all tests
uv run python -m pytest -v

# Run a specific test file
uv run python -m pytest tests/test_api.py -v

# Run tests matching a pattern
uv run python -m pytest -v -k "test_health"

# Run with coverage (when configured)
uv run python -m pytest --cov=agent --cov=db --cov=tools
```

### Test Database

Tests automatically use SQLite (`test_vela_backend.db`). No Postgres required for testing. The test database is created and torn down automatically.

### Writing Tests

- Place tests in `tests/` with the naming pattern `test_*.py`
- Use `pytest-asyncio` for async tests: `@pytest.mark.asyncio`
- Use `monkeypatch.setenv()` for environment variables
- Use `fastapi.testclient.TestClient` for HTTP endpoint tests

---

## Database Migrations

> **Note:** Vela currently uses ad-hoc migrations in the `lifespan` handler (`agent/main.py:53-113`). This is being migrated to Alembic.

For now, to add a new column or table:

1. **Update `schema.sql`** — add the `CREATE TABLE` or `ALTER TABLE` statement with `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
2. **Update the lifespan handler** — add a corresponding migration block in `agent/main.py`
3. **Update `db/models.py`** — add the SQLAlchemy model

---

## Submitting Changes

1. Ensure tests pass: `uv run python -m pytest -v`
2. Update `README.md` if your change affects setup or usage
3. Document new environment variables in `.env.example`
4. For new features, add tests covering the core behavior
5. Keep PRs focused — one feature or fix per PR

---

## Troubleshooting

### `DATABASE_URL is not set`
Your `.env` file is missing or not loaded. Ensure you're running from `backend/` or have `DATABASE_URL` in your environment.

### `ModuleNotFoundError: No module named 'db'`
Run commands from the `backend/` directory, or set `PYTHONPATH`:
```bash
PYTHONPATH=./backend uv run python -m pytest
```

### `connection to server at "db.xxx.supabase.co" failed`
- Check your `DATABASE_URL` is correct (Supabase → Settings → Database)
- Ensure your IP is allowlisted in Supabase (or use the connection pooler)

### `ModuleNotFoundError` after pulling changes
Re-sync dependencies:
```bash
uv sync --all-groups
```

### Tests fail with SQLite errors
Delete the stale test database and re-run:
```bash
rm backend/test_vela_backend.db
uv run python -m pytest -v
```

---

## Need Help?

- Open an issue on [GitHub](https://github.com/parth5012/Vela/issues)
- Check existing ADRs in `docs/ADR/` for architectural decisions
- Review `CONTEXT.md` for the domain model### 2. Set Up Database (Neon, Supabase, or Local Postgres)

1. Create a new project in your database provider of choice (e.g., [Neon](https://neon.tech), [Supabase](https://supabase.com), or run a PostgreSQL database locally).
2. Initialize the tables:
   - Open the SQL Editor, console, or client tool of your database provider.
   - Copy the contents from ackend/db/schema.sql and run them to set up all tables and enable the pgvector vector extension.
3. Copy your database connection string and set it as DATABASE_URL in your configuration details.
   - **Neon:** postgresql://[user]:[password]@[project].neon.tech/[dbname]?sslmode=require
   - **Supabase:** postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
   - **Local Postgres:** postgresql://postgres:[password]@localhost:5432/vela



### 3. Deploy to Render

This repo includes a [`render.yaml`](../render.yaml) Blueprint for one-click deployment:

1. **Fork this repo** to your own GitHub account
2. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint Instance**
3. Connect your forked repo
4. Render will auto-detect `render.yaml` and create the web service
5. Fill in the environment variables when prompted:

| Variable | Value |
|----------|-------|
| `GOOGLE_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) (free Gemini API key) |
| `VELA_API_KEY` | Any secure random string — this is YOUR client auth token |
| `SUPABASE_URL` | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase → Settings → API |
| `DATABASE_URL` | From Supabase → Settings → Database |

6. Click **Deploy** — Render will install dependencies and start the server

> **Alternative: Manual Render setup** (without Blueprint)
> 1. Render Dashboard → **New** → **Web Service** → connect your repo
> 2. Set **Root Directory** to `backend`
> 3. Set **Build Command** to `uv sync --frozen`
> 4. Set **Start Command** to `uv run uvicorn agent.main:app --host 0.0.0.0 --port $PORT`
> 5. Add all environment variables from the table above
> 6. Choose **Starter** plan ($7/month — required for always-on; free tier sleeps after 15 min)

### 4. Verify Deployment

Once deployed, Render gives you a URL like `https://vela-backend.onrender.com`. Test it:

```bash
curl https://vela-backend.onrender.com/
# Expected: {"status":"ok"}
```

### 5. Connect the Android Client

1. Download the latest APK from [Vela Android Client Releases](https://github.com/parth5012/vela-android-client/releases)
2. Install it on your Android device
3. On first launch, enter:
   - **Server URL:** Your Render URL (e.g., `https://vela-backend.onrender.com`)
   - **API Key:** The `VELA_API_KEY` value you set in Render's environment

The app will verify the connection via `GET /health` and you're ready to go.

### 6. Configure Optional Features

After the basic setup works, you can add more capabilities by adding environment variables in Render:

| Variable | Feature Enabled |
|----------|----------------|
| `TAVILY_API_KEY` | Web search ([get key](https://tavily.com)) |
| `E2B_API_KEY` | Sandboxed code execution ([get key](https://e2b.dev)) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot gateway |
| `DISCORD_BOT_TOKEN` | Discord bot gateway |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Gmail/Calendar OAuth |

> **Note:** After adding env vars in Render, the service auto-redeploys. No need to redeploy manually.

### Render Plan Recommendation

| Plan | Cost | When to Use |
|------|------|-------------|
| **Free** | $0 | Testing only — sleeps after 15 min of inactivity, slow cold starts |
| **Starter** | $7/month | Production use — always on, reliable response times |

For a personal assistant you'll use daily, **Starter** is recommended to avoid cold-start delays.

---

## Local Development Setup

For contributors who want to modify the backend:

```bash
cd backend

# Install all dependencies including dev tools
uv sync --all-groups

# Set up pre-commit hooks (if available)
# pre-commit install

# Run the server with hot reload
uv run uvicorn agent.main:app --reload
```

### Environment Variables for Development

For local development, you can use a simplified `.env`:

```env
# === Required ===
GOOGLE_API_KEY=your_gemini_key
VELA_API_KEY=dev_key_change_me
SUPABASE_URL=https://your_project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
DATABASE_URL=postgresql://postgres:password@db.your_project.supabase.co:5432/postgres

# === Optional (features disabled without these) ===
TAVILY_API_KEY=
E2B_API_KEY=
TELEGRAM_BOT_TOKEN=
DISCORD_BOT_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/oauth/callback
```

> **Tip:** Features degrade gracefully. Without `TAVILY_API_KEY`, web search is unavailable. Without Telegram/Discord tokens, those gateways stay offline.

---

## Project Architecture

```
backend/
├── agent/              # FastAPI app + LangGraph supervisor
│   ├── main.py         # REST endpoints, OAuth, webhooks, lifespan
│   ├── graph.py        # LangGraph state machine definition
│   ├── router.py       # Intent routing (tool vs skill)
│   ├── memory.py       # Semantic memory read/write
│   ├── self_improve.py # Evaluation + prompt refinement
│   ├── prompt_builder.py
│   ├── persona.py      # Persona definitions
│   └── registry.py     # Agent registry
├── db/                 # Database layer
│   ├── models.py       # SQLAlchemy ORM models
│   ├── session.py      # Engine + session factory
│   ├── client.py       # CRUD wrapper
│   ├── supabase.py     # Supabase proxy (routes through SQLAlchemy)
│   └── schema.sql      # Full database schema
├── tools/              # Tool implementations (Tavily, E2B, Gmail, Calendar, etc.)
├── skills/             # Multi-turn agentic skills (Brainstorm, Research, Coding)
├── gateway/            # Chat platform integrations (Telegram, Discord)
├── cron/               # Scheduled tasks (consolidation, health)
├── utils/              # Helpers (auth gate, LLM fallback, logger, ULID)
└── tests/              # pytest test suite
```

### Key Design Patterns

- **Supervisor Pattern:** `graph.py` defines a LangGraph state machine that routes incoming messages to either a tool or a multi-turn skill.
- **Auth Gate:** Tools requiring OAuth call `ensure_google_auth()` before execution. If no token exists, the agent returns an auth URL to the user.
- **LLM Fallback:** The system tries providers in order: Gemini → Groq → OpenRouter → Cohere. If one fails, it automatically falls back.

---

## Development Workflow

1. **Create a branch:** `git checkout -b feature/your-feature-name`
2. **Make changes** — see [Coding Conventions](#coding-conventions) below
3. **Run tests:** `uv run python -m pytest -v`
4. **Test manually:** Start the server and hit endpoints with curl or the Swagger UI at `/docs`
5. **Commit and push** — commit messages should be descriptive
6. **Open a Pull Request** against `main`

---

## Coding Conventions

### Python Style

- **Formatter:** We use `ruff` for both linting and formatting (when configured)
- **Type hints:** All function signatures should include type hints
- **Async first:** Use `async def` for I/O-bound operations (API calls, DB queries)
- **No comments unless necessary:** Code should be self-documenting. Use comments only for "why," not "what."

### Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `snake_case.py` | `web_search.py` |
| Classes | `PascalCase` | `SupabaseDB` |
| Functions | `snake_case` | `get_llm()` |
| Constants | `UPPER_SNAKE` | `PERSONA_LIST` |
| Private | `_leading_underscore` | `_internal_helper()` |

### Imports

Group imports in this order (enforced by ruff when configured):
1. Standard library
2. Third-party packages
3. Local modules

```python
import os
import asyncio
from typing import Optional

from fastapi import FastAPI, Depends
from sqlalchemy import create_engine

from db.session import get_db_session
from utils.logger import StructuredLogger
```

### Environment Variables

- Use `os.getenv("VAR_NAME", "default")` for optional vars with sensible defaults
- Use `os.getenv("VAR_NAME")` (returns `None`) for optional vars without defaults
- Raise `ValueError` at startup for required vars that are missing

---

## Testing

```bash
# Run all tests
uv run python -m pytest -v

# Run a specific test file
uv run python -m pytest tests/test_api.py -v

# Run tests matching a pattern
uv run python -m pytest -v -k "test_health"

# Run with coverage (when configured)
uv run python -m pytest --cov=agent --cov=db --cov=tools
```

### Test Database

Tests automatically use SQLite (`test_vela_backend.db`). No Postgres required for testing. The test database is created and torn down automatically.

### Writing Tests

- Place tests in `tests/` with the naming pattern `test_*.py`
- Use `pytest-asyncio` for async tests: `@pytest.mark.asyncio`
- Use `monkeypatch.setenv()` for environment variables
- Use `fastapi.testclient.TestClient` for HTTP endpoint tests

---

## Database Migrations

> **Note:** Vela currently uses ad-hoc migrations in the `lifespan` handler (`agent/main.py:53-113`). This is being migrated to Alembic.

For now, to add a new column or table:

1. **Update `schema.sql`** — add the `CREATE TABLE` or `ALTER TABLE` statement with `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
2. **Update the lifespan handler** — add a corresponding migration block in `agent/main.py`
3. **Update `db/models.py`** — add the SQLAlchemy model

---

## Submitting Changes

1. Ensure tests pass: `uv run python -m pytest -v`
2. Update `README.md` if your change affects setup or usage
3. Document new environment variables in `.env.example`
4. For new features, add tests covering the core behavior
5. Keep PRs focused — one feature or fix per PR

---

## Troubleshooting

### `DATABASE_URL is not set`
Your `.env` file is missing or not loaded. Ensure you're running from `backend/` or have `DATABASE_URL` in your environment.

### `ModuleNotFoundError: No module named 'db'`
Run commands from the `backend/` directory, or set `PYTHONPATH`:
```bash
PYTHONPATH=./backend uv run python -m pytest
```

### `connection to server at "db.xxx.supabase.co" failed`
- Check your `DATABASE_URL` is correct (Supabase → Settings → Database)
- Ensure your IP is allowlisted in Supabase (or use the connection pooler)

### `ModuleNotFoundError` after pulling changes
Re-sync dependencies:
```bash
uv sync --all-groups
```

### Tests fail with SQLite errors
Delete the stale test database and re-run:
```bash
rm backend/test_vela_backend.db
uv run python -m pytest -v
```

---

## Need Help?

- Open an issue on [GitHub](https://github.com/parth5012/Vela/issues)
- Check existing ADRs in `docs/ADR/` for architectural decisions
- Review `CONTEXT.md` for the domain model

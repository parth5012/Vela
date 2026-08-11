# Patterns & Conventions

> Code patterns, naming conventions, and idioms specific to this project.

## Naming Conventions

- **Backend (Python)**: `snake_case` for modules, functions, variables; `PascalCase` for classes (e.g. `SupabaseDB`, `TelegramGateway`, `BaseSkill`); SQLAlchemy models are singular nouns (`Conversation`, `Experience`, `OAuthToken`).
- **Client (TypeScript/React)**: `camelCase` for functions/variables, `PascalCase` for components and types (`ChatScreen`, `ThreadOptionsModal`, `Message`, `Thread`); Zustand stores named `use<Name>Store` (`useChatStore`, `useConfigStore`, `useBrowserStore`, `useGoogleAuthStore`).
- **Gateway files** are named after the channel (`telegram.py`, `discord.py`, `carbonvoice.py`).
- **Test files** mirror the module under test: `test_<module>.py` in `backend/tests/`; `*.test.ts(x)` in `client/__tests__/`.

## Code Patterns

- **Supervisor Agent Pattern (LangGraph)**: `agent/graph.py` defines the graph; `agent/router.py` classifies intent and routes to tools or skills.
- **Authentication Gate**: `utils/auth_gate.py` — tools requiring external service access check saved credentials and abort with a redirect URL if missing.
- **OAuth Auto-Refresh Propagation**: expired access tokens are refreshed with the refresh token and immediately written back to the DB (ADR-0002).
- **Skill base class**: `skills/base.py` defines the abstract interface; concrete skills (`brainstorming`, `research`, `coding`) subclass it.
- **Semantic memory**: embeddings (512-dim) stored in pgvector, queried via `db/supabase.py`.
- **Explicit tool binding**: agents define their own tool registries (`agent/registry.py`) to reduce token usage and prevent unauthorized tool access (ADR-0001).
- **Zustand stores** with `zustand` for client state; `expo-sqlite` + drizzle-orm for local persistence.
- **SSE streaming**: client consumes `POST /chat/message` as SSE chunks via `client/utils/sse.ts`; parse content/delta/done events.

## Testing Patterns

- **Backend**: pytest + pytest-asyncio. `uv run python -m pytest -v` from `backend/`. `backend/tests/conftest.py` provides fixtures; tests cover gateways, graph, db, tools, OAuth, auth gate, SSE concurrency.
- **Client**: Jest with `jest-expo` preset. Tests live in `client/__tests__/` (e.g. `history.test.ts`, `useChatStore.test.ts`, `promptCompiler.test.ts`, `ThreadOptionsModal.test.tsx`).
- No mocking framework conventions established beyond what tests use; follow the nearest existing test file.

## Import/Module Conventions

- **Backend**: package-relative imports within the `backend` project (e.g. `from db.client import DBClient`, `from tools.web_search import ...`). No barrel files observed.
- **Client**: `client/` is the Expo app root; use relative imports. Expo Router file-based routing under `client/app/` (`_layout.tsx`, `index.tsx`, `settings.tsx`, `setup.tsx`).

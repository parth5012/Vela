# Vela Architecture Contract

> Certified source-of-truth architecture contract for the Vela repository.
> Extracted from codebase inspection, import analysis, and git evidence.
> Principle: Describes what IS, verified against actual imports.

## 1. System Topology & Repository Boundaries

Vela is a distributed personal AI assistant composed of an Android/Expo mobile client and a self-hosted FastAPI/LangGraph backend. The codebase is organized as a multi-runtime repository with strict physical and logical boundaries:

```
Vela (Root)
├── client/          # Mobile client: React Native 0.86, Expo 57, TypeScript, Hermes
└── backend/         # Server backend: Python 3.12, FastAPI, LangGraph, SQLAlchemy, uv
```

### Boundary Rule: Client vs Backend Isolation
There are **zero source-level cross-imports** between `client/` and `backend/`.
- `client/` does not import Python modules or reference `backend/` source files.
- `backend/` does not import TypeScript files or reference `client/` source files.
- **Communication Contract**: Interaction occurs exclusively over HTTP REST, Server-Sent Events (SSE) at `POST /chat/message`, and WebSocket at `/ws/omni`.
- **Import Verification Evidence**:
  - `rg "(import|require).*['\"].*backend" client/` yields **0** source code imports.
  - `rg "^(from|import) .*client" backend/` yields **0** imports of client source code (all matches are internal `backend/db/client.py` or standard library `fastapi.testclient`).

---

## 2. Client Architecture Layering (`client/`)

The mobile client is strictly layered into hierarchical subsystems:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Routing & Screens (`client/app/`)                        │
└───────────────┬───────────────────────────┬─────────────────┘
                │                           │
┌───────────────v───────────┐   ┌───────────v─────────────────┐
│ 2. UI Components          │   │ 3. State Stores             │
│    (`client/components/`) │   │    (`client/store/`)        │
└───────────────┬───────────┘   └───────────┬─────────────────┘
                │                           │
┌───────────────v───────────────────────────v─────────────────┐
│ 4. Native Modules & Utilities (`client/modules/`, `utils/`) │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────v─────────────────────────────┐
│ 5. Local Database & Repositories (`client/db/`)             │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: Routing & Screens (`client/app/`)
- **Role**: Top-level Expo Router route handlers (`index.tsx`, `settings/*.tsx`, `_layout.tsx`).
- **Inbound Rule**: Leaf entry point. **No other module in `client/` may import from `client/app/`**.
- **Evidence**: `rg "from ['\"].*app/" client/components/ client/store/ client/utils/ client/db/` returns **0 matches**.

### Layer 2: UI Presentation (`client/components/`)
- **Role**: Reusable chat bubbles (`MessageRow.tsx`, `RichText.tsx`), controls (`GoogleWorkspaceCard.tsx`), and overlays (`DrawerContent.tsx`).
- **Dependencies**: Imports stores (`client/store/`), utils (`client/utils/`), hooks (`client/hooks/`), and types (`client/types/`).
  - Evidence: `client/components/chat/MessageRow.tsx: import { Message } from '../../store/useChatStore';`
  - Evidence: `client/components/chat/RichText.tsx: import { parseContentIncremental } from '../../utils/latexExtractor';`
- **Boundary Invariant**: Components **never import routes (`client/app/`)** and **never import the database directly (`client/db/`)**. UI elements interact with persistent data exclusively through Zustand stores or custom hooks.
  - Evidence: `rg "from ['\"].*db" client/components/` yields **0 matches**.

### Layer 3: State Stores (`client/store/`)
- **Role**: Reactive state management via Zustand.
  - `useChatStore.ts`: Hydrated chat history, thread tracking, message lifecycle.
  - `useActiveStreamStore.ts`: Ephemeral token buffer during live streams (isolated from message lists to prevent cell re-render thrash).
  - `useConfigStore.ts`: User preferences, API keys, model selections (persisted via `AsyncStorage` + `SecureStore`).
  - `useBrowserStore.ts`: WebView browser automation session state.
- **Boundary Invariant**: Stores **never import UI components (`client/components/`)** or **screens (`client/app/`)**.
  - Evidence: `rg "from ['\"].*(components|app)" client/store/` yields **0 matches**.
- **Persistence Boundary**: `useChatStore.ts` imports `../db/client` and `../db/chatRepository` strictly for startup hydration and debounced persistence.

### Layer 4: Utilities & Native Modules (`client/utils/`, `client/modules/`)
- **Role**: Pure logic, parsers (`latexExtractor.ts`, `messageParser.ts`), networking (`sse.ts`, `streamController.ts`, `serverStream.ts`), and native bridges (`modules/device-agent`, `modules/needle`).
- **Boundary Invariant**: Utilities and native modules **never import UI components** or **screens**.
  - Evidence: `rg "from ['\"].*(components|app)" client/utils/ client/modules/` yields **0 matches**.

### Layer 5: Local Database (`client/db/`)
- **Role**: Local-first storage using Expo SQLite (`openDatabaseSync`) with Drizzle ORM (`drizzle-orm/expo-sqlite`).
  - `schema.ts`: Schema definitions (`threads`, `messages`, `tasks`, `checkIns`, `operationLog`). Zero store dependencies.
  - `client.ts`: Database singleton, pragmas (`journal_mode = WAL`), schema migrations.
  - Repositories (`chatRepository.ts`, `agentRepository.ts`): Typed data access functions.
- **Boundary Invariant**: Schema and DB client never import components or screens.

---

## 3. Backend Architecture Layering (`backend/`)

The Python backend is an async FastAPI service organized around a LangGraph Supervisor pattern:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. API Ingress & Gateways (`backend/agent/main.py`, `gateway/`)│
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────v─────────────────────────────────────────────┐
│ 2. Supervisor Graph & Routing (`backend/agent/graph.py`, `router.py`)
└───────────────┬───────────────────────────┬─────────────────┘
                │                           │
┌───────────────v───────────┐   ┌───────────v─────────────────┐
│ 3. Skills (`skills/`)     │   │ 4. Tool Registry (`tools/`) │
└───────────────┬───────────┘   └───────────┬─────────────────┘
                │                           │
┌───────────────v───────────────────────────v─────────────────┐
│ 5. Database Layer (`backend/db/`)                           │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────v─────────────────────────────┐
│ 6. Utilities (`backend/utils/`)                             │
└─────────────────────────────────────────────────────────────┘
```

### Layer Dependency Rules:
1. **Utilities (`backend/utils/`)**: Leaf package. Implements logging, ULID generation, Google OAuth auth-gate. **Never imports `agent`, `db`, `tools`, `skills`, or `gateway`**.
   - Evidence: `rg "^(from|import) (agent|db|tools|skills|gateway|cron)" backend/utils/` yields **0 matches**.
2. **Database (`backend/db/`)**: Persistence models (`models.py`), session management (`session.py`), and Supabase/pgvector client (`supabase.py`). Only imports `backend/utils/`. **Never imports `agent`, `gateway`, `tools`, `skills`, or `cron`**.
   - Evidence: `rg "^(from|import) (agent|gateway|tools|skills|cron)" backend/db/` yields **0 matches**.
3. **Tools (`backend/tools/`)**: Tool implementations (Gmail, Calendar, web search, webview browser, device agent). Only imports `backend/db/` and `backend/utils/`. **Never imports `agent`, `gateway`, or `cron`**.
   - Evidence: `rg "^(from|import) (agent|gateway|cron)" backend/tools/` yields **0 matches**.
4. **Skills (`backend/skills/`)**: Multi-turn workflows (brainstorming, coding, research). Only imports `backend/tools/`, `backend/db/`, and `backend/utils/`. **Never imports `agent` or `gateway`**.
   - Evidence: `rg "^(from|import) (agent|gateway|cron)" backend/skills/` yields **0 matches**.
5. **Gateways (`backend/gateway/`)**: External channels (Telegram, Discord, CarbonVoice). Only imports `backend/db/` and `backend/utils/`. **Never imports `tools` or `skills`**.
   - Evidence: `rg "^(from|import) (tools|skills)" backend/gateway/` yields **0 matches**.

---

## 4. Data Layer Ownership & Invariants

1. **Messages & Threads**:
   - **Client**: SQLite (`client/db/schema.ts` tables `threads`, `messages`) is the local-first authority for offline-first display. Zustand `useChatStore` hydrates from SQLite on launch.
   - **Backend**: PostgreSQL (`backend/db/models.py` model `Conversation`) is the server authority. Synced via `POST /chat/message` and `POST /api/sync/push`.
2. **Streaming Tokens**:
   - Live incoming tokens are owned by `useActiveStreamStore.ts` during generation.
   - They are committed to `useChatStore` and SQLite only upon frame boundaries / stream completion to avoid AST re-parse thrashing.
3. **Authentication & Secrets**:
   - Client API keys reside in `expo-secure-store` via `client/store/useConfigStore.ts`.
   - Backend OAuth tokens reside in `OAuthToken` table (`backend/db/models.py`) protected by `utils/auth_gate.py`.

---

## 5. Machine-checkable Rules

These rules define strict structural prohibitions. Ticket WF-462-03 will translate these exact directives into the automated boundary checker configuration (`dependency-cruiser` / `import-linter`):

- forbid client/components/** -> client/app/**
- forbid client/components/** -> client/db/**
- forbid client/store/** -> client/components/**
- forbid client/store/** -> client/app/**
- forbid client/utils/** -> client/components/**
- forbid client/utils/** -> client/app/**
- forbid client/types/** -> client/components/**
- forbid client/types/** -> client/app/**
- forbid client/types/** -> client/store/**
- forbid client/modules/** -> client/components/**
- forbid client/modules/** -> client/app/**
- forbid client/** -> backend/**
- forbid backend/** -> client/**
- forbid backend/db/** -> backend/agent/**
- forbid backend/db/** -> backend/gateway/**
- forbid backend/db/** -> backend/tools/**
- forbid backend/db/** -> backend/skills/**
- forbid backend/tools/** -> backend/agent/**
- forbid backend/tools/** -> backend/gateway/**
- forbid backend/utils/** -> backend/agent/**
- forbid backend/utils/** -> backend/db/**
- forbid backend/utils/** -> backend/tools/**
- forbid backend/utils/** -> backend/skills/**

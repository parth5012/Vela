# Contributing to Vela & Developer Guide

This document contains all developer-facing documentation, local environment setup instructions, architecture references, and testing standards for contributing to the Vela project.

---

## 🛠️ Developer Prerequisites

* **Python:** 3.11+
* **Package Manager:** [`uv`](https://github.com/astral-sh/uv) (fast Python package manager)
* **Node.js & npm:** Node 20+ (for the Expo / React Native Android client)
* **Database:** PostgreSQL instance with `pgvector` enabled (Supabase or self-hosted)

---

## 💻 Local Development Setup

### 1. Backend Setup

```bash
cd backend

# Sync dependencies using uv
uv sync

# Configure environment variables
cp .env.example .env
```

Key environment variables in `backend/.env`:
```ini
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
DATABASE_URL="postgresql://postgres:password@db.your-project.supabase.co:5432/postgres"
GOOGLE_API_KEY="your-gemini-api-key"
VELA_API_KEY="your-static-bearer-key"
TAVILY_API_KEY="your-tavily-api-key"
E2B_API_KEY="your-e2b-api-key"
```

Initialize the database schema:
1. Paste `backend/db/schema.sql` into your Supabase SQL editor (or run against PostgreSQL).
2. Verify setup:
   ```bash
   uv run python scripts/setup_check.py
   ```

Launch the local backend:
```bash
uv run uvicorn agent.main:app --host 0.0.0.0 --port 8000 --reload
```
Swagger API docs will be live at `http://localhost:8000/docs`.

### 2. Client Setup (Expo Android)

```bash
cd ../client

# Install dependencies
npm install

# Start Expo development server
npm start
```

Run on an Android device:
```bash
npm run android
```

---

## 🧪 Testing & CI Gate

Vela enforces a single-command unified gate:

```bash
# Run the full CI test suite (backend, client, corpus, and e2e)
python vela_ci.py ci

# Run specific stacks
python vela_ci.py ci --stack backend
python vela_ci.py ci --stack client
python vela_ci.py ci --stack corpus

# UI Screenshot Quality Council
npx tsx scripts/ui-council.ts --dry-run path/to/screenshot.png

# Compare Performance Metrics Snapshot
node scripts/metrics-compare.ts --baseline perf-baseline.json --current current.json
```

---

## 📡 API & Streaming Protocol

Communication between client and backend uses high-throughput Server-Sent Events (SSE):

* **Endpoint:** `POST /chat/message`
* **Headers:** `Authorization: Bearer <VELA_API_KEY>`, `Content-Type: application/json`
* **Request Payload:**
  ```json
  {
    "thread_id": "thread-uuid",
    "message": "User query",
    "persona": "personal assistant"
  }
  ```
* **SSE Chunks:**
  * `data: {"type": "content", "delta": "Partial token text"}`
  * `data: {"type": "done", "thread_title": "Generated Title"}`

---

## 📂 Project Structure

```text
Vela/
├── backend/                  # FastAPI + LangGraph Python Backend
│   ├── agent/                # Supervisor graph, router, persona prompts, concurrency
│   ├── db/                   # SQLAlchemy ORM, Supabase pgvector client, migrations
│   ├── tools/                # Device agent, Gmail, Calendar, Tavily, E2B, WebView
│   ├── skills/               # Research, Coding, Brainstorming, Mermaid graphs
│   ├── gateway/              # Telegram, Discord, CarbonVoice gateways
│   ├── cron/                 # Nightly prompt consolidation & health checks
│   ├── scripts/              # Setup validator and database migration scripts
│   └── tests/                # pytest unit & integration test suites
├── client/                   # React Native (Expo SDK 57) Android Client
│   ├── app/                  # File-based routes (chat, browser, tasks, settings)
│   ├── components/           # Aurora glass UI, KaTeX, Mermaid, Code blocks, Feed
│   ├── modules/              # Native Kotlin/C++ modules:
│   │   ├── device-agent/     # Shizuku AIDL service & AccessibilityService
│   │   ├── needle/           # Needle-3 Cactus C++ engine JNI bindings
│   │   └── stable-diffusion/ # On-device Vulkan-accelerated image generator
│   ├── store/                # Zustand state stores (Chat, Config, Browser, Auth)
│   └── utils/                # SSE client, metrics ring buffer, local LLM wrappers
├── scripts/                  # UI Council scoring & Metrics regression comparators
├── docs/                     # Architectural Decision Records (ADRs) & specs
└── vela_ci.py                # Single-command CI gate
```

---

## 🤝 Submitting Changes

1. Fork the repository and create your feature branch from `main`.
2. Ensure all changes follow existing code conventions and formatting.
3. Validate your changes pass the gate:
   ```bash
   python vela_ci.py ci
   ```
4. Write clear, atomic commits that explain *what* and *why*.
5. Open a Pull Request against `main`.

# Vela: Personal Supervisor Agent Backend

Vela is an advanced, FastAPI-powered personal assistant backend designed to interact with users via Telegram. It uses a **Supervisor Agent Pattern** built on **LangGraph** to coordinate routing between simple utility tools and complex, multi-turn cognitive skills.

---

## 🚀 Key Features

*   **Supervisor Graph (LangGraph):** Orchestrates intent classification and executes routing dynamically between tools and sub-agent workflows.
*   **Long-Term Semantic Memory (Supabase pgvector):** Leverages text embeddings to store and query contextually relevant memory history server-side.
*   **Google Workspace OAuth Integration:** Automates token exchanges and credentials management for Gmail and Google Calendar.
*   **Tavily Web Search:** Integrated web searching.
*   **E2B Sandboxed Sandbox:** Secure code execution playground.
*   **Nightly Self-Improvement Loop:** Processes recent transaction experiences, evaluates response performance, and refines system prompts dynamically.

---

## 🛠️ Tech Stack

*   **Runtime:** Python 3.11+
*   **Package Manager:** [uv](https://github.com/astral-sh/uv) (fast Python packaging tool)
*   **API Framework:** FastAPI & Uvicorn
*   **Workflow Engine:** LangGraph & LangChain Core
*   **Database:** Supabase PostgreSQL (utilizing the `vector` extension)
*   **Telegram Library:** `python-telegram-bot`
*   **Testing:** `pytest` & `pytest-asyncio`

---

## 📦 Project Structure

```text
Vela/
├── db/
│   ├── schema.sql            # Database migration script (tables & extensions)
│   └── supabase.py           # Supabase DB CRUD client wrapper
├── agent/
│   ├── main.py               # FastAPI server (Webhook, OAuth callbacks, and Cron routes)
│   ├── graph.py              # LangGraph Supervisor workflow definition
│   ├── router.py             # Supervisor Routing Node
│   ├── memory.py             # Semantic Memory utility helpers
│   ├── self_improve.py       # LLM-based evaluation logic
│   └── prompt_builder.py     # Prompt assembly
├── tools/
│   ├── web_search.py         # Tavily search client
│   ├── code_exec.py          # E2B execution wrapper
│   ├── gmail.py              # OAuth Gmail helper
│   ├── calendar.py           # OAuth Calendar helper
│   └── github.py             # GitHub API actions
├── skills/
│   ├── base.py               # Abstract base class for multi-turn skills
│   ├── brainstorming.py      # Clarifying interview simulator
│   ├── research.py           # Deep research agent
│   └── coding.py             # Sandbox developer/reviewer
├── gateway/
│   └── telegram.py           # Telegram Update parser
├── cron/
│   └── consolidate.py        # System prompt consolidation script
└── tests/                    # Comprehensive unit tests suite
```

---

## ⚙️ Quick Start

### 1. Prerequisites
Ensure you have `uv` installed. If not, install it using:
```bash
# On macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# On Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### 2. Install Dependencies
Initialize the virtual environment and sync packages:
```bash
uv sync
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and fill in the required keys:
```bash
cp .env.example .env
```

**Key configurations include:**
*   `TELEGRAM_BOT_TOKEN`: Obtained from `@BotFather`.
*   `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`: Found in your Supabase project settings.
*   `GOOGLE_API_KEY`: API key for Gemini LLM.
*   `TAVILY_API_KEY` & `E2B_API_KEY`: External credentials for tools.
*   `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: For Google Calendar & Gmail OAuth callback.

### 4. Database Setup
1. Go to your **Supabase Dashboard** > **SQL Editor**.
2. Create a new query.
3. Paste the contents of `db/schema.sql` (which activates the `pgvector` extension and creates all required tables).
4. Run the query.

### 5. Running the Application
Start the FastAPI server locally:
```bash
uv run uvicorn agent.main:app --reload
```
The server will start on `http://127.0.0.1:8000`. You can visit `http://127.0.0.1:8000/health` to confirm it is running.

### 6. Setting Up Telegram Webhook
Expose your server (e.g., using `ngrok` for local development: `ngrok http 8000`). Once you have an `https` URL, register it with Telegram:
```text
https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=<YOUR_HTTPS_URL>/webhooks/telegram
```

---

## 🧪 Running Tests

A comprehensive test suite is provided in the `tests/` directory. Run all unit tests with:
```bash
uv run python -m pytest -v
```

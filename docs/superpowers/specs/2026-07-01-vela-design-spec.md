# Vela Supervisor Agent System Design

**Date:** 2026-07-01  
**Status:** Approved  
**Author:** Antigravity (AI Coding Assistant)  

---

## 1. Project Overview & Scope
Vela is a personal agent backend designed to run on a FastAPI server deployed to Render. It communicates with users via a Telegram bot interface. Vela uses a Supervisor Agent pattern (via LangGraph) to orchestrate tools and skills. It features long-term semantic memory (via pgvector), dynamic prompt management, an automated OAuth flow for Google Workspace (Gmail, Calendar), and an offline self-improvement consolidation loop.

---

## 2. Directory Layout
The project follows a modular monolith structure using `uv` for python environment and dependency management.

```text
Vela/
├── .env.example              # Template for API keys and configurations
├── pyproject.toml            # Project dependencies and metadata
├── README.md                 # Brief setup instructions
├── db/
│   ├── __init__.py
│   ├── schema.sql            # Database migrations / table creation SQL
│   └── supabase.py           # Supabase client and DB queries
├── agent/
│   ├── __init__.py
│   ├── main.py               # FastAPI entry point (webhook endpoint & OAuth)
│   ├── graph.py              # LangGraph supervisor workflow definition
│   ├── router.py             # Router logic (intent -> tool/skill)
│   ├── memory.py             # Read/write Supabase memory integrations
│   ├── self_improve.py       # Evaluation & prompt consolidation logic
│   └── prompt_builder.py     # Assembler for dynamic system prompts
├── tools/
│   ├── __init__.py
│   ├── web_search.py         # Tavily tool
│   ├── code_exec.py          # E2B sandboxed execution tool
│   ├── gmail.py              # Google Mail OAuth tool
│   ├── calendar.py           # Google Calendar OAuth tool
│   ├── github.py             # GitHub API client
│   └── notion.py             # Notion integration placeholder
├── skills/
│   ├── __init__.py
│   ├── base.py               # Abstract base class for agent skills
│   ├── brainstorming.py      # Brainstorming skill
│   ├── research.py           # Deep research skill
│   └── coding.py             # Coding/Code Review skill
├── gateway/
│   ├── __init__.py
│   └── telegram.py           # Webhook handler for python-telegram-bot
└── cron/
    ├── __init__.py
    ├── health.py             # Keep-alive ping route
    └── consolidate.py        # Nightly cron trigger for self-improvement
```

---

## 3. Database Schema (Supabase PostgreSQL)

Vela uses Supabase to persist user conversations, long-term memory, google OAuth tokens, dynamic system prompts, and experiences.

```sql
-- Conversations Table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id BIGINT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- OAuth Tokens Table
CREATE TABLE oauth_tokens (
    conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- e.g., 'google'
    token_data JSONB NOT NULL,    -- Structure containing access_token, refresh_token, expiry, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Long-term Semantic Memory Table
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL, -- 768 dimensions for Gemini text embeddings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX ON memory_vectors USING hnsw (embedding vector_cosine_ops);

-- Experiences Log for Self-Improvement
CREATE TABLE experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_query TEXT NOT NULL,
    agent_response TEXT NOT NULL,
    eval_score FLOAT, -- Automated LLM evaluation (0.0 to 1.0)
    eval_reason TEXT,
    consolidated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Dynamic System Prompt Fragments
CREATE TABLE system_prompt_fragments (
    key VARCHAR(100) PRIMARY KEY, -- e.g. 'base', 'persona'
    content TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Skills Registry
CREATE TABLE skills_registry (
    name VARCHAR(100) PRIMARY KEY,
    description TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

---

## 4. Agent Architecture (LangGraph Supervisor)

Vela uses a LangGraph `StateGraph` driven by a central Supervisor LLM.

### Graph State
```python
from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    telegram_chat_id: int
    db_conv_id: str
    relevant_memories: list[str]
    next_node: str
```

### Flow Execution
1. **Load Node:** Fetches conversation context, retrieves semantic long-term memories from Supabase, and queries the database for active system prompt fragments.
2. **Supervisor Node:** Uses LLM (with function calling) to assess the state. It decides to:
   - Call a single-execution Tool (Tavily, E2B, Gmail, Calendar, GitHub, Notion).
   - Enter a multi-turn State Machine/Skill (Brainstorming, Research, Coding).
   - Respond to the user (`__end__`).
3. **Response Node:** Compiles the response, updates long-term memory candidates, triggers the Telegram Bot Client to reply, and writes the conversation experience log to Supabase.

---

## 5. Integrations & API Gateway

### Telegram Webhook
Exposes `POST /webhooks/telegram` endpoint. The `python-telegram-bot` webhook handles incoming messages and feeds them to the LangGraph executor.

### Google OAuth Flow
- `GET /oauth/login?chat_id=<id>`: Generates Authorization URL with state payload containing the Telegram chat ID.
- `GET /oauth/callback`: Receives the OAuth authorization code, exchanges it for credentials, and stores them in the `oauth_tokens` table. Displays a success confirmation page.

### Cron Endpoints
- `GET /health`: Keep-alive endpoint.
- `POST /consolidate`: Nightly cron trigger. Fetches all unconsolidated experiences (`consolidated = false`), uses an LLM to evaluate interactions, extracts generalizable instructions, and updates the `system_prompt_fragments` accordingly to improve future responses.

---

## 6. Security & Environment Config
Configuration variables to be maintained in the `.env` file:
- `TELEGRAM_BOT_TOKEN`: Key for Telegram bot API.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: Supabase project configuration.
- `GOOGLE_API_KEY`: API key for Google Gemini LLM / embedding services.
- `TAVILY_API_KEY`: For web searching.
- `E2B_API_KEY`: For sandboxed Python execution.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`: For Gmail & Calendar OAuth.
- `GITHUB_TOKEN`: For GitHub API access.

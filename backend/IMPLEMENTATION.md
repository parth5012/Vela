Folder Structure

agent/
├── main.py                  # FastAPI app, webhook endpoint
├── agent/
│   ├── graph.py             # LangGraph supervisor graph
│   ├── router.py            # intent → skill/tool routing
│   ├── memory.py            # read/write Supabase memory
│   ├── self_improve.py      # eval + consolidation logic
│   └── prompt_builder.py    # assembles system prompt from fragments
├── tools/
│   ├── web_search.py        # Tavily
│   ├── code_exec.py         # E2B wrapper
│   ├── gmail.py             # your existing OAuth code
│   ├── calendar.py          # your existing OAuth code
│   ├── github.py            # GitHub API
│   └── notion.py            # Notion MCP
├── skills/
│   ├── base.py              # Skill base class
│   ├── brainstorming.py     # follows your brainstorming pattern
│   ├── research.py          # deep research skill
│   └── coding.py            # code review / generation skill
├── gateway/
│   └── telegram.py          # python-telegram-bot webhook handler
├── cron/
│   ├── health.py            # GET /health — keep-alive endpoint
│   └── consolidate.py       # POST /consolidate — nightly self-improvement
└── db/
    └── supabase.py          # all DB read/write helpers


System Design

Telegram
    ↓ webhook
FastAPI (Render)
    ↓
Supervisor Agent (LangGraph)
    ├── Tool Router
    │     ├── Web Search (Tavily free)
    │     ├── Code Execution (E2B)
    │     ├── Gmail / Calendar (your existing OAuth)
    │     ├── GitHub API
    │     └── Notion (MCP)
    ├── Skill Router
    │     ├── BrainstormingSkill
    │     ├── ResearchSkill
    │     ├── CodingSkill
    │     └── (pluggable — add more as .py files)
    ├── Memory Manager
    │     ├── Short-term (in-request context)
    │     ├── Long-term (Supabase pgvector)
    │     └── Experience log (self-improvement feed)
    └── Self-Improvement Loop
          ├── Eval step (post-interaction)
          └── Consolidation cron (nightly)

Supabase PostgreSQL
    ├── conversations
    ├── memory_vectors (pgvector)
    ├── experiences
    ├── system_prompt_fragments
    └── skills_registry

E2B API
    └── Sandboxed Python execution

cron-job.org
    ├── /health ping every 10 min (keep-alive)
    └── /consolidate trigger nightly (self-improvement)
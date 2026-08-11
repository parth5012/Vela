# 01 — [DB & Webhooks] Migrate Database Settings & Lock Bot Gateways

**What to build:**
Run database schema transition to rename/migrate the `conversations.persona` column to `conversations.agent` dynamically on startup inside `agent/main.py::lifespan`. Update bot gateways (Telegram in `gateway/telegram.py` and Discord in `gateway/discord.py`) to hardcode that they execute graph requests using the `"personal assistant"` agent and ignore any database-defined agent setting, preventing channel collision and unauthorized subagent switching via chat webhooks.

**Blocked by:** None (start immediately)

**Status:** ready-for-agent

## Acceptance Criteria
- [ ] The database migration script executes inside FastAPI setup `lifespan` without query errors, renaming or creating `agent` setting column.
- [ ] Telegram gateway inputs explicitly inject `"persona": "personal assistant"` (or `"agent": "personal assistant"`) into graph inputs.
- [ ] Discord gateway inputs explicitly inject `"persona": "personal assistant"` (or `"agent": "personal assistant"`) into graph inputs.
- [ ] All unit tests matching database query patterns pass cleanly.

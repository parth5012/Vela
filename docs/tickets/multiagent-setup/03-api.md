# 03 — [API] Client Selection & Messaging Endpoint Streaming

**What to build:**
Update the FastAPI `POST /chat/message` streaming endpoint payload schema to accept `agent` instead of the static `persona` validation list. Verify the conversation record registers the selected agent value in the database, and streams the graph response back using Server-Sent Events (SSE).

**Blocked by:** 02 — [Orchestrator] Dynamic Agent Registries & State Transitioning

**Status:** ready-for-agent

## Acceptance Criteria
- [ ] `MessagePayload` expects `agent` parameter, defaulting to `personal assistant`.
- [ ] Unsupported agent specifications raise HTTP 400 Bad Request detailing supported choices.
- [ ] Conversation records in the database persist the chosen active agent dynamically.
- [ ] The endpoint successfully issues token-based streaming output for agent sessions via SSE.

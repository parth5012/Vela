# 02 — [Orchestrator] Dynamic Agent Registries & State Transitioning

**What to build:**
Replace the dynamic persona dictionary imports with a formal codebase agent configuration registry where each agent declares its identifier, prompt template instructions, and list of bound tools. Refactor the supervisor graph logic to read from this registry, updating state references from `persona` to `agent` variables and ensuring prompt generation outputs agent-specific guidelines cleanly.

**Blocked by:** 01 — [DB & Webhooks] Migrate Database Settings & Lock Bot Gateways

**Status:** ready-for-agent

## Acceptance Criteria
- [ ] An `AgentRegistry` exists mapping `personal_assistant`, `google_workspace`, and other configured agent instances.
- [ ] Prompt builders (`agent/prompt.py`) construct system prompts based on the selected agent's instructions.
- [ ] All chatbot executions retrieve and bind only tools declared in the active Agent's tool list registry.
- [ ] Existing tests for personas and memory/experience tracking run green with the updated Agent state variable names.

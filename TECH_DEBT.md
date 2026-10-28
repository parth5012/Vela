# Technical Debt

> Track tech debt separately to distinguish deliberate choices from bugs.

> When a decision is made for pragmatic reasons (deadline, scope), log it here.

> When a bug is actually a choice (not a mistake), log it here.

## Active Debt

_None yet — populate as the agent identifies debt during work._

| ID | Date | Description | Rationale | Impact | Effort to Fix |
|----|------|-------------|-----------|--------|---------------|
| TD-480-01 | 2026-10-27 | Client `stopStream` → backend `POST /chat/threads/{id}/stop` is fire-and-forget (3s timeout, errors swallowed) with no delivery guarantee | Ticket #481 spec explicitly requires non-blocking stop (UI must never hang on backend); deepseek-4.1 round-1 finding rejected per spec, recorded here instead | A dropped stop POST lets one turn keep producing tokens until natural completion; generation scoping contains the blast radius to that turn only | Retry/backoff or SSE-side confirm channel; revisit if stop latency telemetry shows up in production |

## Resolved Debt

_None yet._

| ID | Date Resolved | Description | Resolution |
|----|---------------|-------------|------------|
| —  | —             | —           | —          |

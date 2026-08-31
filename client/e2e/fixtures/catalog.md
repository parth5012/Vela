# Mock Backend Fixtures — POST /chat/message Contract

> For Map #193, Ticket #204. Defines fixture scenarios for each E2E feature.

## Contract

```
POST {url}/chat/message
Body: { "thread_id": "...", "message": "...", "agent": "..." }
Response: SSE stream
  data: {"type": "content", "delta": "..."}    (repeated)
  data: {"type": "done", "thread_title": "..."} (final)
```

All fixtures are served by `mock_server.py --fixture <name>` and read from `fixtures/<name>.json`.

## Fixture Catalog

### chat.json — Chat & SSE Streaming

| Scenario | Request Body | SSE Events | Notes |
|----------|-------------|------------|-------|
| Happy path | `{"message": "Hello", "agent": "personal assistant"}` | 13 content deltas + done | Verifies streaming renders |
| Empty message | `{"message": "", "agent": "personal assistant"}` | 1 content delta + done | Edge case |
| Long response | `{"message": "Write essay", "agent": "teacher"}` | 50+ content deltas + done | Tests streaming over time |
| Error response | `{"message": "error", "agent": "personal assistant"}` | 1 content delta with error text + done | Tests error display |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`
- `/chat/threads`: Array with 1 pre-seeded thread
- `/chat/message`: SSE stream with configurable delay

### setup.json — Server Setup

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| Health check | — | `{"status": "ok", "version": 1.0}` | Used during connection verification |
| Invalid endpoint | — | Connection refused (port 9999) | Tests failure path |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`

### tasks.json — Task Scheduler

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| List tasks | — | 2 pre-seeded tasks (active + paused) | Verifies task list rendering |
| Create task | `{"title": "...", "recurrence": "24h", ...}` | Created task with ID | Verifies creation flow |
| Run task | `POST /tasks/run` | `{"status": "completed"}` | Verifies run-now flow |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`
- `/tasks`: Array of task objects
- `/tasks`: POST returns created task

### browser.json — In-App Browser

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| Health check | — | `{"status": "ok", "version": 1.0}` | Browser doesn't need mock endpoints (loads real URLs) |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`

### settings.json — Settings Hub

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| Get settings | — | Settings object with theme, accent, model, etc. | Verifies settings rendering |
| OAuth status | `GET /oauth/token/status` | Connected/disconnected state | Verifies Google Workspace card |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`
- `/settings`: Settings object
- `/oauth/token/status`: OAuth connection state

### local-ai.json — Local AI Models

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| List models | — | 4 model cards with sizes and status | Verifies model list rendering |
| Download model | `POST /local-ai/download` | `{"status": "started"}` | Verifies download flow |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`
- `/local-ai/models`: Array of model objects
- `/local-ai/download`: Download initiation

### device-agent.json — Device Agent

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| Get status | — | `{"status": "idle", "capabilities": [...]}` | Verifies agent status rendering |
| Execute action | `POST /device-agent/execute` | `{"status": "completed", "result": "..."}` | Verifies execution flow |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`
- `/device-agent/status`: Agent status + capabilities
- `/device-agent/execute`: Execution result

### offline.json — Offline Mode

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| Network disconnect | — | Connection refused | Tested by killing mock server |
| Reconnect | — | Health check succeeds | Tested by restarting mock server |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`

### fcm.json — FCM Push Notifications

| Scenario | Request Body | Response | Notes |
|----------|-------------|----------|-------|
| Register token | `POST /fcm/register` | `{"status": "registered", "token": "..."}` | Verifies registration flow |
| Check status | `GET /fcm/status` | `{"registered": true, "token_preview": "..."}` | Verifies status display |

**Endpoints:**
- `/health`: `{"status": "ok", "version": 1.0}`
- `/fcm/register`: Registration response
- `/fcm/status`: Registration status

## Fixture Loading

```bash
# Single fixture
python mock_server.py --fixture chat

# All fixtures merged
python mock_server.py --fixture all

# Custom port
python mock_server.py --fixture chat --port 9000
```

## Determinism Requirements

- All fixtures must be **deterministic** — no LLM randomness
- SSE events use fixed delay (`delay_ms`) for timing verification
- Thread/task IDs are predictable for assertion matching
- Response text is fixed and grep-able for `uiautomator dump` assertions

## Coverage Matrix

| Feature | Fixture | Happy Path | Error Path | Edge Cases |
|---------|---------|------------|------------|------------|
| Chat Streaming | chat.json | ✓ | ✓ | Empty msg, long response |
| Setup | setup.json | ✓ | ✓ | Invalid endpoint |
| Tasks | tasks.json | ✓ | — | Create, toggle, run |
| Browser | browser.json | ✓ | — | URL load, overlay |
| Settings | settings.json | ✓ | — | Theme, agent, OAuth |
| Local AI | local-ai.json | ✓ | — | Download, toggle |
| Device Agent | device-agent.json | ✓ | — | Execute, status |
| Offline | offline.json | ✓ | — | Disconnect, reconnect |
| FCM | fcm.json | ✓ | — | Register, status |

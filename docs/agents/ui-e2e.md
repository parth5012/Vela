# Agent-driveable UI control

The client can be driven in a browser by an agent or a test, deterministically:
real Expo web UI, real FastAPI routes, real SQLite persistence, and a scripted
LLM instead of a live provider. Nothing is mocked in the browser — there is no
`fetch` interception, no screenshot comparison, and no `sleep`-based waiting.

This is the harness an agent should use before claiming a client change works.

## The two surfaces

| Surface | Enabled by | Gives you |
|---|---|---|
| Backend `/_e2e/*` | `VELA_E2E=1` on the API process | `POST /reset` (reseed DB, clear script), `POST /script` (`{turns: [...]}` programs the FakeProvider), `GET /state` (`remaining_turns`, `calls`, `threads`), `GET /health` |
| `window.__VELA_E2E__` | `EXPO_PUBLIC_E2E=1` on the Expo process | `configure({apiUrl, apiKey})`, `seedChat({threadId, title, agent, messages, clearFirst})`, `getChatState()`, `getConfigState()`, `waitForIdle(ms)`, `goTo(path)` |

Both are dev-only: the backend refuses to mount the channel without
`VELA_E2E=1`, and the client only installs the global hook when
`EXPO_PUBLIC_E2E=1`. Production builds expose neither.

`waitForIdle()` is the synchronization primitive — it resolves when streaming
finishes and the store settles. Never sleep instead; a sleep is a flake.

## Running it

```bash
python vela_ci.py e2e        # from the repo root; boots both servers itself
cd client && npx playwright test
```

`client/playwright.config.ts` starts both processes: the API via
`uv run python -m agent.testing.e2e_server --port 8123` (from `backend/`) and
Expo web via `npx expo start --web --port 8081` (from `client/`). First Expo
boot takes up to ~4 minutes; both servers are reused when already running
outside CI. One worker, zero retries — a failure is a real failure.

## What an agent can do with it

- Click, type, and navigate the real app in Chromium, then assert on
  `getChatState()` / `backendState()` rather than on incidental DOM.
- Program exactly which assistant turns arrive (`/script`) and assert the app
  consumed them (`/state.remaining_turns` reaching 0).
- Seed a thread or navigate to a deep link instead of replaying setup steps.
- Drive any Expo web route (`goTo('/settings')`), so new surfaces only need a
  spec, not new harness code.

Covered today in `client/e2e/ui/chat-flow.spec.ts`: deep-link boot with seeded
config (no setup screen), a turn sent through the real UI with the scripted
reply persisted, and the briefing screen rendering seeded backend data.

## Boundaries

- **Web only.** The Android build and its webview are not driven here; device
  work still needs ADB (see `client/AGENTS.md`).
- **The LLM is scripted.** `FakeProvider` replays the turns you program, so this
  verifies plumbing, persistence, and UI state — never model quality.
- **No visual assertions.** Failures surface as state mismatches, not pixel
  diffs; screenshots are captured on failure only.
- **Not an exploratory agent.** The harness is deterministic by design. An
  agent that wants to poke around interactively should drive the same servers
  through its browser tool while keeping `/script` in control.

## Files

| File | Role |
|---|---|
| `backend/agent/testing/e2e_server.py` | Real app + `FakeProvider` + `/_e2e/*` control channel |
| `backend/agent/testing/__init__.py` | Binds a disposable SQLite DB so no `.env` is needed |
| `backend/tests/test_e2e_server_boot.py` | Proves the server boots in a bare environment |
| `client/e2e/ui/e2e.ts` | Control-channel and in-page helper API |
| `client/e2e/ui/chat-flow.spec.ts` | The UI specs |
| `client/playwright.config.ts` | Server boot, ports, single-worker policy |

# Agent-driveable UI control

The client can be driven in a browser by an agent or a test, deterministically:
real Expo web UI, real FastAPI routes, real SQLite persistence, and a scripted
LLM instead of a live provider. Nothing is mocked in the browser — there is no
`fetch` interception, no screenshot comparison in the functional suite, and no `sleep`-based waiting.

This is the harness an agent should use before claiming a client change works.

## Independence of Playwright and ADB Harnesses

The test infrastructure provides two strictly independent end-to-end verification mechanisms:

1. **Device-Free Playwright Suite (Browser / Expo Web)**:
   - Command: `python vela_ci.py e2e` or `cd client && npm run e2e`
   - **No device needed**: completely device-free, requiring no physical Android phone, no Android emulator, and no ADB installation.
   - Runs against real Expo web in headless Chromium with the real FastAPI backend, a temporary SQLite database, and scripted `FakeProvider`.
   - Covers all 20 canonical features across 3 waves (`client/e2e/ui/specs/`) and is validated via `npm run e2e:coverage` against `client/e2e/ui/COVERAGE.md`.
   - Accompanied by an advisory visual regression suite (`npm run e2e:visual`) running at standard mobile viewport (360×640) across normal and reduced-motion modes.

2. **Android Native ADB Harness (APK / Emulator)**:
   - Command: `bash client/e2e/runner.sh` (or `bash client/e2e/runner.sh --dry-run` for dry-run verification)
   - Requires an Android emulator (`emulator-5554`) or physical device, ADB, and a built release APK.
   - **Completely independent** from the Playwright suite: the two suites share no runtime processes, no port assignments, and no execution dependencies.

## The two surfaces

| Surface | Enabled by | Gives you |
|---|---|---|
| Backend `/_e2e/*` | `VELA_E2E=1` on the API process | `POST /reset` (reseed DB, clear script), `POST /script` (`{turns: [...]}` programs the FakeProvider), `POST /fixture` (loads named fixtures), `GET /state` (`remaining_turns`, `calls`, `threads`, `available_fixtures`), `GET /health` |
| `window.__VELA_E2E__` | `EXPO_PUBLIC_E2E=1` on the Expo process | `configure({apiUrl, apiKey})`, `seedChat({threadId, title, agent, messages, clearFirst})`, `seedThreads(...)`, `getChatState()`, `getConfigState()`, `getThreadsState()`, `waitForIdle(ms)`, `goTo(path)` |

Both are dev-only: the backend refuses to mount the channel without
`VELA_E2E=1`, and the client only installs the global hook when
`EXPO_PUBLIC_E2E=1`. Production builds expose neither.

`waitForIdle()` is the synchronization primitive — it resolves when streaming
finishes and the store settles. Never sleep instead; a sleep is a flake.

## Running it

```bash
python vela_ci.py e2e        # from the repo root; boots both servers itself
cd client && npm run e2e     # runs all 20 specs directly with playwright
cd client && npm run e2e:coverage # validates all 20 specs exist in COVERAGE.md
cd client && npm run e2e:visual   # runs advisory visual regression suite at 360x640
```

`client/playwright.config.ts` starts both processes: the API via
`uv run python -m agent.testing.e2e_server --port 8123` (from `backend/`) and
Expo web via `npx expo start --web --port 8081` (from `client/`). First Expo
boot takes up to ~4 minutes; both servers are reused when already running
outside CI. One worker, zero retries — a failure is a real failure.

## What an agent can do with it

- Click, type, and navigate the real app in Chromium, then assert on
  `getChatState()` / `backendState()` rather than on incidental DOM.
- Program exactly which assistant turns arrive (`/script`) or load pre-packaged fixture scenarios (`/fixture`).
- Assert the app consumed all scripted turns (`/state.remaining_turns` reaching 0).
- Seed threads, messages, or configurations directly instead of replaying setup steps.
- Drive any Expo web route (`goTo('/settings')`, `goTo('/tasks')`, `goTo('/browser')`), so new surfaces only need a
  spec, not new harness code.

## Boundaries

- **Web only.** The Android native APK and its device bridges (e.g. accessibility, hardware camera/mic) are mocked or simulated in browser tests; native verification uses the ADB harness (`client/e2e/runner.sh`).
- **The LLM is scripted.** `FakeProvider` replays the turns you program, so this
  verifies plumbing, persistence, and UI state — never model quality.
- **Visual assertions are segregated.** The functional `e2e` suite contains zero screenshot comparisons. Visual baseline assertions live in their own advisory suite (`playwright.visual.config.ts` / `npm run e2e:visual`).
- **Not an exploratory agent.** The harness is deterministic by design. An
  agent that wants to poke around interactively should drive the same servers
  through its browser tool while keeping `/script` in control.

## Files

| File | Role |
|---|---|
| `backend/agent/testing/e2e_server.py` | Real app + `FakeProvider` + `/_e2e/*` control channel |
| `backend/agent/testing/__init__.py` | Binds a disposable SQLite DB so no `.env` is needed |
| `backend/tests/test_e2e_server_boot.py` | Proves the server boots in a bare environment |
| `backend/tests/test_e2e_control_channel.py` | Validates `/fixture`, `/reset`, `/state`, and error/delay streaming |
| `client/e2e/ui/e2e.ts` | Control-channel and in-page helper API (`resetWorld`, `seedChat`, `seedThreads`, `goTo`) |
| `client/e2e/ui/loader.ts` | Type-safe in-browser window accessor (`__VELA_E2E__`) |
| `client/e2e/ui/COVERAGE.md` | Feature matrix covering all 20 specs across Waves A, B, and C |
| `client/e2e/ui/specs/*.spec.ts` | The 20 feature specs |
| `client/playwright.config.ts` | Server boot, ports, single-worker policy for functional suite |
| `client/playwright.visual.config.ts` | Dedicated advisory visual config at 360×640 across normal and reduced motion |

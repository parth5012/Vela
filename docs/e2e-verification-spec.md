# Vela E2E Verification Specification

> **Status**: Locked & hand-off-ready
> **Map**: [#193](https://github.com/parth5012/Vela/issues/193)
> **Generated**: 2026-08-31
> **Harness**: `vela-e2e-testing` skill, package `com.parth5012.client.dev`
> **Target**: `emulator-5554`, mock FastAPI on `127.0.0.1:8000`

---

## 1. Overview & Destination

This spec defines a complete E2E verification pass for the Vela Android client. Every shipped feature is mapped to an emulator + mock-backend + ADB verification step. The pass itself is **not** executed inside this map — this is the hand-off document for parallel executors.

**Success criteria**: The spec names the oracle, fixtures, harness skeleton, and lane split so parallel executors can run the full pass without further decisions.

---

## 2. Feature Inventory

61 total shipped features (43 client, 18 backend). 20 client-surface features are in E2E scope.

| E2E # | Feature | Lane | Source |
|--------|---------|------|--------|
| E1 | Server Setup | critical-path | PRODUCT.md, app/setup.tsx |
| E2 | Chat Streaming | critical-path | PRODUCT.md, app/index.tsx |
| E3 | Thread Management | critical-path | PRODUCT.md, app/_layout.tsx |
| E4 | Rich Rendering | critical-path | PRODUCT.md, utils/messageParser.ts |
| E5 | Collapsible Blocks | critical-path | PRODUCT.md, components/chat/ |
| E6 | Tasks | extended | PRODUCT.md, app/tasks.tsx |
| E7 | In-App Browser | extended | PRODUCT.md, app/browser.tsx |
| E8 | Settings Hub | extended | PRODUCT.md, app/settings/ |
| E9 | Theme & Appearance | extended | PRODUCT.md, app/settings/appearance.tsx |
| E10 | Agent Config | extended | PRODUCT.md, app/settings/agent.tsx |
| E11 | Local AI | parallel | PRODUCT.md, app/settings/local-ai.tsx |
| E12 | Device Agent | parallel | Wayfinder #100-105, utils/deviceActionExecutor.ts |
| E13 | Offline Sync | parallel | Wayfinder #138-141, utils/offlineSync.ts |
| E14 | FCM Push | parallel | Wayfinder #130-137, utils/pushRegistration.ts |
| E15 | Google OAuth | extended | PRODUCT.md, components/oauth/ |
| E16 | Briefing | extended | Wayfinder #121-129, app/briefing.tsx |
| E17 | Message Actions | critical | PRODUCT.md, components/chat/ |
| E18 | Safety Tier Badges | critical | Wayfinder #160, components/chat/ |
| E19 | Cookie Viewer | extended | Wayfinder #155, utils/cookieSync.ts |
| E20 | Task Progress | extended | Wayfinder #170-172, app/task-progress.tsx |

Full inventory: `client/e2e/inventory.md`

---

## 3. Oracle Definitions

Each feature has a pass/fail oracle defining observable state, ADB commands, and tolerances.

| E2E # | Feature | Key ADB Assertion | Tolerance | Retry |
|--------|---------|-------------------|-----------|-------|
| E1 | Setup | `uiautomator dump` + grep "Save & Continue" → "verified" → "Send" | 10s launch, 5s connect | — |
| E2 | Chat | `uiautomator dump` + grep "Send" → typed text → "Response to" | 5s SSE | SSE retry |
| E3 | Threads | `uiautomator dump` + grep thread title in drawer | 3s | — |
| E4 | Rich Render | `screencap` + visual: Markdown/LaTeX/Mermaid/code | 3s | — |
| E5 | Collapsible | `uiautomator dump` + grep "thought\|intent\|tool\|skill" | 2s | — |
| E6 | Tasks | `uiautomator dump` + grep "Add Task" → task card | 3s | Hermes retry |
| E7 | Browser | `uiautomator dump` + grep "Webview" → "Send" (back) | 5s | WebView retry |
| E8 | Settings | `uiautomator dump` + grep "Settings" → sub-screen names | 2s | — |
| E9 | Theme | `screencap` + visual: atmosphere/accent/font | 2s | — |
| E10 | Agent | `uiautomator dump` + grep model pills + temperature | 2s | — |
| E11 | Local AI | `uiautomator dump` + grep "Cloud\|Local" + model names | 5s | — |
| E12 | Device Agent | `uiautomator dump` + grep "idle\|active" + result | 5s | — |
| E13 | Offline | `curl` health fail → "offline" → health OK → response | 10s | — |
| E14 | FCM | `uiautomator dump` + grep "registered\|FCM" | 5s | — |
| E15 | OAuth | `uiautomator dump` + grep "Connect\|Gmail\|Calendar" | 5s | — |
| E16 | Briefing | `uiautomator dump` + grep "Briefing\|watch\|history" | 3s | — |
| E17 | Msg Actions | `uiautomator dump` + grep action menu items | 2s | — |
| E18 | Safety Tiers | `uiautomator dump` + grep safety tier pill text | 2s | — |
| E19 | Cookie Viewer | `uiautomator dump` + grep "Cookie" | 2s | — |
| E20 | Task Progress | `uiautomator dump` + grep progress states | 3s | — |

**Global fail**: Any `ReactNativeJS|Hermes|SQLite` error in logcat = instant FAIL.

Full oracles: `client/e2e/oracles/index.md`

---

## 4. Mock Fixture Catalog

9 fixture files served by `mock_server.py --fixture <name>`.

| Fixture | Endpoints | Scenarios |
|---------|-----------|-----------|
| `chat.json` | /health, /chat/threads, /chat/message (SSE) | 4 (happy, empty, long, error) |
| `setup.json` | /health | 2 (valid, invalid) |
| `tasks.json` | /health, /tasks | 3 (list, create, run) |
| `browser.json` | /health | 1 (health only) |
| `settings.json` | /health, /settings, /oauth/token/status | 2 (settings, OAuth) |
| `local-ai.json` | /health, /local-ai/models, /local-ai/download | 2 (list, download) |
| `device-agent.json` | /health, /device-agent/status, /device-agent/execute | 2 (status, execute) |
| `offline.json` | /health | 1 (disconnect test) |
| `fcm.json` | /health, /fcm/register, /fcm/status | 2 (register, status) |

**Contract**: `POST /chat/message` → SSE `content`/`done` events
**Determinism**: All fixtures use fixed delay_ms, grep-able text, predictable IDs

Full catalog: `client/e2e/fixtures/catalog.md`

---

## 5. Harness Skeleton & Directory Structure

```
client/e2e/
├── fixtures/           # Mock backend scenarios (per feature)
│   ├── chat.json
│   ├── setup.json
│   ├── tasks.json
│   ├── browser.json
│   ├── settings.json
│   ├── local-ai.json
│   ├── device-agent.json
│   ├── offline.json
│   └── fcm.json
├── oracles/            # Pass/fail criteria per feature
│   ├── index.md        # Master oracle definitions
│   ├── setup.md
│   ├── chat.md
│   ├── tasks.md
│   ├── browser.md
│   ├── settings.md
│   ├── local-ai.md
│   ├── device-agent.md
│   ├── offline.md
│   └── fcm.md
├── lanes/              # Lane definitions for parallel execution
│   ├── critical-path.yaml
│   ├── extended-coverage.yaml
│   └── parallel-surface.yaml
├── inventory.md        # Feature inventory
├── mock_server.py      # Parameterized mock backend
├── runner.sh           # Main orchestrator
└── README.md           # This file
```

**Runner**: `bash client/e2e/runner.sh --lane <name>` or `--feature <name>`
**Dry run**: `bash client/e2e/runner.sh --dry-run` (validates fixtures/oracles without ADB)

---

## 6. Lane Decomposition

### Execution Flow

```
                    ┌─────────────────┐
                    │  critical-path  │ (sequential, abort on failure)
                    │  Setup → Chat   │
                    │  → Threads      │
                    └────────┬────────┘
                             │ PASS
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
    ┌──────────────────┐         ┌──────────────────┐
    │ extended-coverage│         │ parallel-surface │
    │ Tasks, Browser,  │         │ Local-AI,        │
    │ Settings, OAuth, │         │ Device-Agent,    │
    │ Briefing, Cookie │         │ Offline, FCM,    │
    │ Task Progress    │         │                  │
    └──────────────────┘         └──────────────────┘
         (parallel)                   (parallel)
```

### Lane Definitions

| Lane | Features | Execution | Abort on Failure |
|------|----------|-----------|-----------------|
| **critical-path** | Setup, Chat, Threads, Rich Rendering, Collapsible Blocks, Msg Actions, Safety Tiers | Sequential | Yes |
| **extended-coverage** | Tasks, Browser, Settings, Themes, Agent Config, OAuth, Briefing, Cookie Viewer, Task Progress | Parallel | No |
| **parallel-surface** | Local AI, Device Agent, Offline Sync, FCM Push | Parallel | No |

### Failure Policy

- **Critical-path**: Blocking — must pass before other lanes start
- **Extended-coverage**: Non-blocking — failures reported, don't block verdict
- **Parallel-surface**: Non-blocking — failures reported, don't block verdict

Full lane YAML: `client/e2e/lanes/`

---

## 7. Flakiness & Retry Policy

| Decision | Choice |
|----------|--------|
| **Pass criteria** | Strict (1/1) — every test must pass in a single run |
| **Retry strategy** | Pre-flight retries — harness retries internally before reporting failure |
| **Retry count** | 2 retries, 5s fixed backoff (3 total attempts, 10s max overhead) |
| **Retry scope** | SSE streaming (E2), WebView overlay (E7), Hermes crashes (E6) |
| **Final verdict** | PASS if any of 3 attempts succeeds; FAIL only if all 3 fail |

### Implementation

```bash
# Retry wrapper (in runner.sh)
retry_with_backoff() {
    local max_attempts=3
    local delay=5
    for attempt in $(seq 1 $max_attempts); do
        if "$@"; then
            echo "PASS (attempt $attempt/$max_attempts)"
            return 0
        fi
        if [ $attempt -lt $max_attempts ]; then
            echo "Retry $attempt/$max_attempts — sleeping ${delay}s..."
            sleep $delay
        fi
    done
    echo "FAIL (all $max_attempts attempts failed)"
    return 1
}
```

---

## 8. Reporting Artifact

**Format**: HTML dashboard (self-contained, no CDN dependencies)
**Source**: Static template + JSON data from `summary.json`
**Location**: `client/e2e/results/<timestamp>/index.html`

### Dashboard Sections

1. **Run Summary** — timestamp, device, pass/fail counts, duration
2. **Lane Breakdown** — per-lane pass/fail with blocking/non-blocking distinction
3. **Per-Feature Cards** — expandable cards showing:
   - Pass/fail status
   - Retry attempts (e.g., "PASS (attempt 2/3)")
   - Duration
   - Screenshot thumbnail (clickable)
   - Logcat excerpts (if errors)
4. **Flakiness Trend** — pass rate per feature across last 10 runs

### Summary JSON Schema

```json
{
  "timestamp": "2026-08-31T12:00:00Z",
  "device": "emulator-5554",
  "duration_seconds": 120,
  "lanes": {
    "critical-path": {
      "status": "PASS",
      "features": {
        "setup": { "status": "PASS", "attempts": 1, "duration_ms": 5000 },
        "chat": { "status": "PASS", "attempts": 2, "duration_ms": 12000 }
      }
    },
    "extended-coverage": { ... },
    "parallel-surface": { ... }
  },
  "summary": { "total": 20, "passed": 18, "failed": 2, "skipped": 0 }
}
```

---

## 9. Local Model & OAuth Fixture Decisions

### Local Model Fixture

| Decision | Choice |
|----------|--------|
| **E2E fixture** | Mock-labeled fallback (deterministic, no disk issues) |
| **Real inference** | Optional smoke test (SmolLM, 400MB), separate from E2E pass |
| **Rationale** | Emulator disk limited, MediaPipe version floor, non-deterministic output |
| **Mock honesty** | App already labels mock output as mock (committed behavior) |

### OAuth Mock Depth

| Decision | Choice |
|----------|--------|
| **E2E fixture** | Stubbed tokens (fake JWT, no Google API call) |
| **Setup flow** | Mock `/oauth/token/status` with connected state + scope badges |
| **Data fetch** | Out of scope for mock-based E2E (backend pytest covers this) |
| **Rationale** | No real credentials in CI; setup flow is the critical user path |

Full decisions: `client/e2e/fixtures/local-model-decision.md`, `client/e2e/fixtures/oauth-decision.md`

---

## 10. Hand-off Checklist for Parallel Executors

### Prerequisites

- [ ] `emulator-5554` running (Android emulator)
- [ ] Release APK built: `client/android/app/build/outputs/apk/release/app-x86_64-release.apk`
- [ ] Python 3.10+ with FastAPI + uvicorn installed
- [ ] ADB installed and in PATH

### Setup Steps

```bash
# 1. Start mock backend
cd client/e2e
python mock_server.py --fixture all &

# 2. Reverse port to emulator
adb -s emulator-5554 reverse tcp:8000 tcp:8000

# 3. Install release APK
adb -s emulator-5554 install -r -d \
  ../../android/app/build/outputs/apk/release/app-x86_64-release.apk

# 4. Launch app
adb -s emulator-5554 shell am start -n com.parth5012.client.dev/.MainActivity

# 5. Run full verification
bash runner.sh --lane critical-path
bash runner.sh --lane extended-coverage &
bash runner.sh --lane parallel-surface &
wait

# 6. Generate report
bash runner.sh --report results/
```

### What Executors Need

- [ ] `client/e2e/inventory.md` — feature list
- [ ] `client/e2e/oracles/index.md` — pass/fail criteria
- [ ] `client/e2e/fixtures/catalog.md` — mock contracts
- [ ] `client/e2e/lanes/*.yaml` — lane definitions
- [ ] `client/e2e/runner.sh` — orchestrator
- [ ] `client/e2e/mock_server.py` — mock backend

### No Further Decisions Needed

All decisions are locked:
- ✅ Pass criteria: Strict 1/1
- ✅ Retry policy: 2 retries, 5s backoff, all flaky areas
- ✅ Lane structure: 3 lanes, parallel secondary, non-blocking
- ✅ Reporting: HTML dashboard, static template + JSON
- ✅ Local model: Mock-labeled fallback
- ✅ OAuth: Stubbed tokens

---

*This spec is the hand-off document. The full E2E pass and lane execution are the executor's responsibility.*

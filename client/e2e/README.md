# Vela E2E Verification Harness

Automated end-to-end verification for the Vela Android client using ADB automation
against `emulator-5554` with a mock FastAPI backend.

## Architecture

```
client/e2e/
├── fixtures/           # Mock backend scenarios (per feature)
│   ├── chat.json
│   ├── threads.json
│   ├── tasks.json
│   ├── browser.json
│   ├── settings.json
│   ├── local-ai.json
│   ├── device-agent.json
│   ├── offline.json
│   └── fcm.json
├── oracles/            # Pass/fail criteria per feature
│   ├── setup.md
│   ├── chat.md
│   ├── threads.md
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
├── mock_server.py      # Parameterized mock backend (reads fixtures)
├── runner.sh           # Main orchestrator
├── report.sh           # Results formatter
└── README.md           # This file
```

## Quick Start

```bash
# 1. Start mock backend with default fixtures
python client/e2e/mock_server.py --fixture chat

# 2. Reverse port to emulator
adb -s emulator-5554 reverse tcp:8000 tcp:8000

# 3. Install release APK
adb -s emulator-5554 install -r -d \
  client/android/app/build/outputs/apk/release/app-x86_64-release.apk

# 4. Run full verification
bash client/e2e/runner.sh --lane critical-path

# 5. Run single feature
bash client/e2e/runner.sh --feature chat
```

## Fixture Format

Each fixture is a JSON file defining mock responses for a feature:

```json
{
  "feature": "chat",
  "endpoints": {
    "/health": { "status": "ok", "version": 1.0 },
    "/chat/threads": [],
    "/chat/message": {
      "type": "sse",
      "events": [
        { "type": "content", "delta": "Hello " },
        { "type": "content", "delta": "world!" },
        { "type": "done", "thread_title": "Test Chat" }
      ],
      "delay_ms": 50
    }
  }
}
```

## Oracle Format

Each oracle defines what "pass" means for a feature:

```markdown
## Chat Feature Oracle

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Launch app | Setup screen visible | `uiautomator dump` + grep "Save & Continue" | — |
| 2 | Enter server URL | Input field populated | `uiautomator dump` + grep "127.0.0.1:8000" | — |
| 3 | Tap Save | Green checkmark visible | `screencap` + image diff | — |
| 4 | Enter message | Input field populated | `uiautomator dump` + grep message text | — |
| 5 | Tap Send | SSE stream renders | `uiautomator dump` + grep response delta | 2s timeout |
```

## Lane Definitions

Lanes group features for parallel or sequential execution:

- **critical-path**: Setup → Chat → Threads (sequential, must pass)
- **extended-coverage**: Tasks, Browser, Settings (parallel after critical)
- **parallel-surface**: Local-AI, Device-Agent, Offline, FCM (parallel, independent)

## Runner Interface

```bash
# Run all features in a lane
bash client/e2e/runner.sh --lane <lane-name>

# Run a single feature
bash client/e2e/runner.sh --feature <feature-name>

# Run with specific fixture
bash client/e2e/runner.sh --feature chat --fixture chat-v2

# Dry run (validate fixtures + oracles without ADB)
bash client/e2e/runner.sh --dry-run

# Generate report from previous run
bash client/e2e/runner.sh --report results/
```

## Results Format

Each run produces a results directory:

```
results/
├── 2026-08-31T120000/
│   ├── summary.json        # Pass/fail counts, duration
│   ├── chat.json           # Per-feature results
│   ├── setup.json
│   ├── threads.json
│   └── ...
```

## Dependencies

- ADB (Android Debug Bridge)
- Python 3.10+ with FastAPI + uvicorn
- `emulator-5554` running
- Release APK built at `client/android/app/build/outputs/apk/release/app-x86_64-release.apk`

---
name: vela-e2e-testing
description: Use when testing the Vela Android client app end-to-end on an emulator or physical device, setting up mock servers, verifying chat, tasks, browser, setup, or settings workflows, and diagnosing native or webview rendering issues.
---

# Vela Client End-to-End Testing

## Overview
Comprehensive guide and reference for testing the Vela Android client application (`com.parth5012.client.dev`) end-to-end on an Android emulator or device. Covers environment configuration, mock backend setup, build procedures, ADB UI automation, screen verification, and resolution of native rendering edge cases.

---

## When to Use
- Running full QA or regression test passes on the Vela Expo / React Native Android client.
- Verifying individual user flows: Server Setup, Chat & Streaming SSE, Task Scheduler with SQLite, In-App Browser, and Settings Sub-Screens.
- Setting up a local test environment without requiring an external FastAPI / LLM server.
- Diagnosing and debugging blank screens, WebView hardware-acceleration overlays, Hermes runtime errors, or uninitialized SQLite databases.

---

## Environment Setup & Prerequisites

### 1. Device / Emulator Target
- **Target Device**: `emulator-5554` (or any connected Android device).
- **Package Name**: `com.parth5012.client.dev`
- **Main Activity**: `com.parth5012.client.dev/.MainActivity`
- **ADB Policy Note**: For physical personal devices, always follow ADB approval guidelines in `AGENTS.md`. On emulators (`emulator-5554`), full UI automation (`input tap`, `input text`, `screencap`, `uiautomator dump`) is permitted.

### 2. Local Mock Backend Server
Vela requires a FastAPI backend endpoint supporting health check, chat completion streaming (SSE), history sync, and thread operations.

Start a lightweight Python mock server on host port 8000:
```python
# test_server.py
import json, time
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/chat/threads")
def get_threads():
    return []

@app.post("/chat/completions")
async def chat_completions(req: Request):
    data = await req.json()
    persona = data.get("persona", "assistant")
    prompt = data.get("messages", [{}])[-1].get("content", "")

    def event_stream():
        response_text = f"[{persona.upper()}] Response to: {prompt}"
        chunks = response_text.split(" ")
        for chunk in chunks:
            payload = {
                "choices": [{"delta": {"content": chunk + " "}}]
            }
            yield f"data: {json.dumps(payload)}\n\n"
            time.sleep(0.05)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

Run and reverse port to device:
```powershell
python test_server.py
adb -s emulator-5554 reverse tcp:8000 tcp:8000
```

---

## Build & Installation

### 1. Run Unit Tests & Typecheck
Always run tests and TypeScript checks before building native bundles:
```powershell
cd D:\work\projects\Vela\client
npm test
npx tsc --noEmit
```

### 2. Assemble Release APK
Build the release APK using Gradle:
```powershell
cd D:\work\projects\Vela\client\android
.\gradlew.bat assembleRelease
```
The architecture-specific APK will be output at:
`client\android\app\build\outputs\apk\release\app-x86_64-release.apk` (for x86_64 emulator) or `app-arm64-v8a-release.apk` (for physical arm64 devices).

### 3. Install and Launch
```powershell
adb -s emulator-5554 install -r -d D:\work\projects\Vela\client\android\app\build\outputs\apk\release\app-x86_64-release.apk
adb -s emulator-5554 shell am start -n com.parth5012.client.dev/.MainActivity
```

---

## End-to-End Test Flows

### Flow 1: Setup Screen (`/setup`)
1. **Empty Field Validation**: Tap "Save & Continue" with empty fields. Verify inline alert prevents submission.
2. **Invalid Server Ping**: Enter `http://127.0.0.1:9999` and dummy key. Verify failure message (`Connection failed. Check your server URL and API key.`).
3. **Valid Server Connection**: Enter `http://127.0.0.1:8000` and API key `test-key`. Verify green success indicator (`✓ Connection verified successfully!`) and automatic routing to `/`.

### Flow 2: Main Chat & Persona Selection (`/`)
1. **Persona Switching**: Tap persona selector pills ("Assistant", "Teacher", "Analyst"). Verify active pill style updates.
2. **Suggestion Starter**: Tap a suggestion card (e.g. "Teach Concept"). Verify prompt fills into the input field.
3. **Chat Streaming**: Enter message, tap "Send", and verify live Server-Sent Events (SSE) streaming updates the assistant bubble.

### Flow 3: Task Scheduler & SQLite DB (`/tasks`)
1. **Database Hydration Check**: Verify `initializeDatabase()` is called on startup to prevent `no such table: tasks`.
2. **Create Task**:
   - Tap `+ Add Task`.
   - Enter Title (e.g. "Daily Digest"), Recurrence ("24h"), Agent ("personal assistant"), and Prompt.
   - Tap "Save Task". Verify task card appears under `ALL` and `ACTIVE`.
3. **Task Status Toggle**: Toggle the Active switch. Verify status shifts to `PAUSED` and task appears in the `PAUSED` tab.
4. **Run Now**: Tap "Run Now" to trigger background task execution and verify run record in history.

### Flow 4: In-App Browser (`/browser`)
1. **Navigation Bar**: Tap the `🌐 Webview` header toggle button or select `🌐 Browser` from the drawer.
2. **URL Bar**: Enter a URL (e.g., `https://example.com`) and tap "Go". Verify page loads.
3. **Node Status Modal**: Tap the status pill to verify browser node info modal opens.
4. **Overlay Concealment**: Navigate back to Chat or Settings. Verify the hardware-accelerated WebView does not occlude subsequent screens (must use `persistentWebviewHidden` with offscreen positioning `top: -99999`).

### Flow 5: Settings Hub & Sub-Screens (`/settings`)
Verify each sub-screen renders correctly and navigates back via `< Back`:
1. **Server & API Key** (`/settings/connection`): Server URL, API Key, connection testing, and Google Workspace OAuth card.
2. **Theme & Appearance** (`/settings/appearance`): Atmosphere selection (Aurora, Slate, Neon, Void, Dusk, Frost), 8 accent color dots, font size preview.
3. **Agent Settings** (`/settings/agent`): User name input, default persona, model selector pills, temperature slider/stepper, and system prompt.
4. **Local AI** (`/settings/local-ai`): Cloud / Local toggle, on-device model cards (Qwen2.5, TinyLlama, SmolLM, DeepSeek-R1), download manager.
5. **Suggestion Starters** (`/settings/messaging`): Card list with `✕ Remove`, Add Starter form.
6. **About & Danger Zone** (`/settings/about`): App version info, "Reset Server Connection" action.

---

## ADB Inspection & Automation Scripting

### Screencap & UI Hierarchy Capture
```powershell
# Capture Screenshot
adb -s emulator-5554 shell screencap -p /sdcard/screen.png
adb -s emulator-5554 pull /sdcard/screen.png .\screen.png

# Capture UI Hierarchy XML
adb -s emulator-5554 shell uiautomator dump /sdcard/dump.xml
adb -s emulator-5554 pull /sdcard/dump.xml .\dump.xml
```

### Logcat Diagnostics
Filter for JS errors, Hermes crashes, and SQLite exceptions:
```powershell
adb -s emulator-5554 logcat -d *:E | Select-String "ReactNativeJS|com.parth5012|Hermes|SQLite"
```

---

## Known Pitfalls & Solutions

| Pitfall / Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **Chat screen turns blank or unresponsive after browsing** | Android native `WebView` ignores container `display: 'none'` and covers subsequent screens with hardware surface. | Use `persistentWebviewHidden` in `_layout.tsx` (`position: 'absolute', top: -99999, left: -99999, opacity: 0`) and `pointerEvents="none"` when route != `/browser`. |
| **Crash on launch in Release build (`iterator method is not callable`)** | Hermes release engine fails on `[...threads].sort(...)` if `threads` is undefined/non-array before hydration. | Add `Array.isArray(threads)` guard in `DrawerContent.tsx` before spreading or sorting. |
| **`no such table: tasks` error when loading `/tasks`** | `initializeDatabase()` in `db/client.ts` was not invoked during app launch. | Call `initializeDatabase()` inside `_layout.tsx` on hydration and inside `loadTasks()` in `tasks.tsx`. |
| **Android 15 16KB Page Size Warning Dialog** | Android 15 emulator displays informational dialog on cold launch. | Dismiss with `adb shell input tap 540 1400` before inspecting launch screen. |

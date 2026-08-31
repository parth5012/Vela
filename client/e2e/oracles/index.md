# Oracle Definitions — Pass/Fail Criteria Per Feature

> For Map #193, Ticket #203. Cross-references Feature Inventory (#202) with ADB verification patterns.

## Summary Table

| E2E # | Feature | Oracle File | Key ADB Assertion | Tolerance | Retry Scope |
|--------|---------|-------------|-------------------|-----------|-------------|
| E1 | Server Setup | `oracles/setup.md` | `uiautomator dump` + grep "Save & Continue" → "verified" → "Send" | 10s launch, 5s connection | — |
| E2 | Chat Streaming | `oracles/chat.md` | `uiautomator dump` + grep "Send" → typed text → "Response to" | 5s SSE stream | SSE retry |
| E3 | Thread Management | `oracles/chat.md` | `uiautomator dump` + grep thread title in drawer | 3s | — |
| E4 | Rich Rendering | `oracles/chat.md` | `screencap` + visual: Markdown, LaTeX, Mermaid, code blocks rendered | 3s after send | — |
| E5 | Collapsible Blocks | `oracles/chat.md` | `uiautomator dump` + grep "thought\|intent\|tool\|skill" + tap expand | 2s | — |
| E6 | Tasks | `oracles/tasks.md` | `uiautomator dump` + grep "Add Task" → "Save Task" → task card | 3s DB hydration | Hermes retry |
| E7 | In-App Browser | `oracles/browser.md` | `uiautomator dump` + grep "Webview\|Browser" → page load → "Send" (back) | 5s page load | WebView retry |
| E8 | Settings Hub | `oracles/settings.md` | `uiautomator dump` + grep "Settings" → sub-screen names | 2s per screen | — |
| E9 | Theme & Appearance | `oracles/settings.md` | `screencap` + visual: atmosphere names, accent dots, font preview | 2s | — |
| E10 | Agent Config | `oracles/settings.md` | `uiautomator dump` + grep model pills + temperature | 2s | — |
| E11 | Local AI | `oracles/local-ai.md` | `uiautomator dump` + grep "Cloud\|Local" + model card names | 5s download | — |
| E12 | Device Agent | `oracles/device-agent.md` | `uiautomator dump` + grep "idle\|active" + result text | 5s execution | — |
| E13 | Offline Sync | `oracles/offline.md` | `curl` health check fail → "offline" indicator → health OK → response | 10s reconnect | — |
| E14 | FCM Push | `oracles/fcm.md` | `uiautomator dump` + grep "registered\|FCM" + mock server log | 5s registration | — |
| E15 | Google OAuth | `oracles/settings.md` | `uiautomator dump` + grep "Connect\|Gmail\|Calendar" + scope badges | 5s OAuth flow | — |
| E16 | Briefing | `oracles/chat.md` | `uiautomator dump` + grep "Briefing\|watch\|history" | 3s | — |
| E17 | Message Actions | `oracles/chat.md` | `uiautomator dump` + grep action menu items (copy/branch/share/view) | 2s | — |
| E18 | Safety Tier Badges | `oracles/chat.md` | `uiautomator dump` + grep safety tier pill text on tool-call cards | 2s | — |
| E19 | Cookie Viewer | `oracles/settings.md` | `uiautomator dump` + grep "Cookie" in connection sub-screen | 2s | — |
| E20 | Task Progress | `oracles/tasks.md` | `uiautomator dump` + grep progress states (loading/active/done/error) | 3s | — |

## Detailed Oracle Specifications

### E1: Server Setup (`oracles/setup.md`)

**Pass**: Setup screen → empty validation → invalid ping → valid connection → green checkmark → auto-navigate to chat
**ADB**: `uiautomator dump` at each step, grep for expected text
**Tolerance**: 10s for app launch, 5s for connection verification
**Retry**: None (deterministic)

### E2: Chat Streaming (`oracles/chat.md`)

**Pass**: Chat screen loads → persona switch → suggestion starter → type + send → SSE stream renders → done event
**ADB**: `uiautomator dump` + grep for response delta text
**Tolerance**: 5s for full SSE stream completion
**Retry**: SSE streaming area — 2 retries, 5s backoff (per #209)

### E3: Thread Management (`oracles/chat.md`)

**Pass**: Thread list in drawer → create thread → switch → pin → rename
**ADB**: `uiautomator dump` + grep thread titles in drawer
**Tolerance**: 3s per operation
**Retry**: None

### E4: Rich Rendering (`oracles/chat.md`)

**Pass**: Send message triggering Markdown/LaTeX/Mermaid/code → verify rendered output
**ADB**: `screencap` + visual verification (rendered elements present)
**Tolerance**: 3s after send
**Retry**: None

### E5: Collapsible Blocks (`oracles/chat.md`)

**Pass**: Thought/intent/tool/skill blocks visible → tap to expand → content shown → tap to collapse
**ADB**: `uiautomator dump` + grep block type labels + tap coordinates
**Tolerance**: 2s for animation
**Retry**: None

### E6: Tasks (`oracles/tasks.md`)

**Pass**: Tasks screen → Add Task → fill form → save → toggle Active → Run Now
**ADB**: `uiautomator dump` + grep "Add Task" → "Save Task" → task title → "PAUSED"
**Tolerance**: 3s for SQLite hydration
**Retry**: Hermes crash area — 2 retries, 5s backoff (per #209)

### E7: In-App Browser (`oracles/browser.md`)

**Pass**: Browser screen → URL bar → page load → status modal → navigate back → no overlay
**ADB**: `uiautomator dump` + grep "Webview" → `screencap` for overlay check
**Tolerance**: 5s for page load
**Retry**: WebView HW-accel area — 2 retries, 5s backoff (per #209)

### E8: Settings Hub (`oracles/settings.md`)

**Pass**: Settings index → each sub-screen renders → back navigation works
**ADB**: `uiautomator dump` + grep sub-screen names at each level
**Tolerance**: 2s per screen
**Retry**: None

### E9: Theme & Appearance (`oracles/settings.md`)

**Pass**: Atmosphere selection → accent color dots → font size preview → changes applied
**ADB**: `screencap` + visual check for theme changes
**Tolerance**: 2s
**Retry**: None

### E10: Agent Config (`oracles/settings.md`)

**Pass**: Model pills visible → temperature slider → system prompt field → changes persist
**ADB**: `uiautomator dump` + grep model names, temperature value
**Tolerance**: 2s
**Retry**: None

### E11: Local AI (`oracles/local-ai.md`)

**Pass**: Cloud/Local toggle → model cards → download progress → toggle to Local
**ADB**: `uiautomator dump` + grep "Cloud\|Local" + model names
**Tolerance**: 5s for download
**Retry**: None (depends on #205 decision for real vs mock)

### E12: Device Agent (`oracles/device-agent.md`)

**Pass**: Agent status visible → execute mock action → result displayed → capabilities listed
**ADB**: `uiautomator dump` + grep status + result text
**Tolerance**: 5s for execution
**Retry**: None

### E13: Offline Sync (`oracles/offline.md`)

**Pass**: Kill mock → offline indicator → restart mock → message sent successfully
**ADB**: `curl` for health check + `uiautomator dump` for UI state
**Tolerance**: 10s for reconnect + flush
**Retry**: None

### E14: FCM Push (`oracles/fcm.md`)

**Pass**: Registration status visible → token received → POST to /fcm/register succeeded
**ADB**: `uiautomator dump` + grep registration status + mock server log
**Tolerance**: 5s for registration
**Retry**: None

### E15: Google OAuth (`oracles/settings.md`)

**Pass**: Connection sub-screen → Google Workspace card → Connect → scope badges → Disconnect
**ADB**: `uiautomator dump` + grep "Connect\|Gmail\|Calendar" + scope badges
**Tolerance**: 5s for OAuth flow (mock)
**Retry**: None (depends on #206 decision for stub depth)

### E16: Briefing (`oracles/chat.md`)

**Pass**: Briefing settings → watch items → history view → deep link
**ADB**: `uiautomator dump` + grep "Briefing\|watch\|history"
**Tolerance**: 3s
**Retry**: None

### E17: Message Actions (`oracles/chat.md`)

**Pass**: Long-press message → action menu → copy/branch/share/view → markdown viewer overlay
**ADB**: `uiautomator dump` + grep action menu items
**Tolerance**: 2s
**Retry**: None

### E18: Safety Tier Badges (`oracles/chat.md`)

**Pass**: Tool-call card renders → safety tier pill visible with correct tier text
**ADB**: `uiautomator dump` + grep safety tier pill text
**Tolerance**: 2s
**Retry**: None

### E19: Cookie Viewer (`oracles/settings.md`)

**Pass**: Connection sub-screen → Cookie Viewer visible → cookie data displayed
**ADB**: `uiautomator dump` + grep "Cookie" + cookie data
**Tolerance**: 2s
**Retry**: None

### E20: Task Progress (`oracles/tasks.md`)

**Pass**: Task progress route → loading state → active state → done/error state
**ADB**: `uiautomator dump` + grep progress state labels
**Tolerance**: 3s for state transitions
**Retry**: None

## Global Fail Conditions

All features FAIL if any of these appear in logcat:
```
adb -s emulator-5554 logcat -d *:E | grep -i "ReactNativeJS\|Hermes\|SQLite"
```

## Retry Policy (from #209)

- **Pass criteria**: Strict 1/1 — every test must pass in a single run
- **Retry strategy**: Pre-flight retries (harness retries internally)
- **Retry count**: 2 retries, 5s fixed backoff (3 total attempts)
- **Retry scope**: SSE streaming (E2), WebView overlay (E7), Hermes crashes (E6)
- **Final verdict**: PASS if any of 3 attempts succeeds; FAIL only if all 3 fail

# E2E Test Coverage Manifest

This document maps all 20 Vela client-surface features from `docs/e2e-verification-spec.md` §2 and `client/e2e/inventory.md` to their corresponding device-free Playwright E2E specs in `client/e2e/ui/specs/`.

> **Maintenance Rule**: After implementing or modifying any feature, update this coverage manifest and re-run/update the visual baselines (`npm run e2e:visual`). `npm run e2e:coverage` enforces that all 20 features have an existing spec file.

## Coverage Matrix (20 Features)

| # | Feature | Planned Spec Path | What is Asserted | Native-Lane Caveat |
|---|---------|-------------------|-------------------|--------------------|
| 1 | Server Setup | `client/e2e/ui/specs/setup.spec.ts` | First-launch wizard flow, server URL/API key validation, connection check, and seeded-config bypass. | None (web-native) |
| 2 | Chat Streaming | `client/e2e/ui/specs/chat.spec.ts` | Happy turn stream, SSE error turn (`error`), slow stream (`delay`), exact transcript state and remaining turns counter. | None (web-native) |
| 3 | Thread Management | `client/e2e/ui/specs/threads.spec.ts` | Thread creation, switching, pinning, renaming, and drawer state reflection via `get*State()`. | None (web-native) |
| 4 | Rich Rendering | `client/e2e/ui/specs/rich-rendering.spec.ts` | Markdown formatting, LaTeX formulas, Mermaid diagrams, and code block rendering into the DOM. | None (web-native) |
| 5 | Collapsible Blocks | `client/e2e/ui/specs/collapsible-blocks.spec.ts` | Expand/collapse interaction and content display for thought, intent, tool, and skill blocks. | None (web-native) |
| 6 | Message Actions | `client/e2e/ui/specs/message-actions.spec.ts` | Message action bar actions: copy, branch, share, and raw markdown viewer overlay presentation. | None (web-native) |
| 7 | Safety Tier Badges | `client/e2e/ui/specs/safety-tier-badges.spec.ts` | Tool-call execution cards render correct tier badges (Safe, Confirm, Blocked). | None (web-native) |
| 8 | Tasks | `client/e2e/ui/specs/tasks.spec.ts` | Task creation, enabled/disabled toggling, and run-now execution backed by the E2E in-browser SQLite shim. | None (web SQLite shim) |
| 9 | Task Progress | `client/e2e/ui/specs/task-progress.spec.ts` | Step-by-step task execution progress visualization, status indicators, and themed states. | None (web SQLite shim) |
| 10 | In-App Browser | `client/e2e/ui/specs/browser.spec.ts` | Browser screen navigation, URL bar handling, webview active visibility, and cross-screen overlay concealment. | None (web-visible state) |
| 11 | Settings Hub | `client/e2e/ui/specs/settings.spec.ts` | Navigation to and from the settings hub and all primary sub-screen routes. | None (web-native) |
| 12 | Theme & Appearance | `client/e2e/ui/specs/appearance.spec.ts` | Atmosphere themes, accent colors, and font selection persistence and DOM class updates. | None (web-native) |
| 13 | Agent Config | `client/e2e/ui/specs/agent-config.spec.ts` | Model pills selection, custom persona tuning, and temperature slider/input adjustment. | None (web-native) |
| 14 | Google OAuth | `client/e2e/ui/specs/oauth.spec.ts` | Google Workspace card connection status, token stubbing, scope pills, and disconnect flow. | None (web-native) |
| 15 | Briefing | `client/e2e/ui/specs/briefing.spec.ts` | Daily briefing view rendering, watch items list, trigger actions, and briefing history view. | None (web-native) |
| 16 | Cookie Viewer | `client/e2e/ui/specs/cookie-viewer.spec.ts` | Browser session cookie extraction, inspection table, and seeded cookie listing. | None (web-native) |
| 17 | Local AI | `client/e2e/ui/specs/local-ai.spec.ts` | Model selection, download state, and fallback routing label display. | **Native-boundary caveat**: Playwright spec asserts web/mock state; the ADB harness remains the real proof for on-device GGUF/LiteRT model loading and execution. |
| 18 | Device Agent | `client/e2e/ui/specs/device-agent.spec.ts` | Device automation status, permission requirements, and safety-tier confirmation UI. | **Native-boundary caveat**: Playwright spec asserts web/mock state; the ADB harness remains the real proof for Android Accessibility, Shizuku, and JNI actions. |
| 19 | Offline Sync | `client/e2e/ui/specs/offline.spec.ts` | Offline queueing state indicator, queued message retention, and simulated reconnection flush. | **Native-boundary caveat**: Playwright spec asserts web/mock state; the ADB harness remains the real proof for native network listeners and disk persistence across kills. |
| 20 | FCM Push | `client/e2e/ui/specs/fcm.spec.ts` | Push notification registration token display, deep-link handling from notification payloads. | **Native-boundary caveat**: Playwright spec asserts web/mock state; the ADB harness remains the real proof for native Android Firebase notification delivery and system tray interactions. |

## Extended Features (Wayfinder Maps)

| Feature | Subsystem | Validation |
|---|---|---|
| Floating Overlay (Mini-Chat Bubble) (#596) | `client/components/overlay/` | Unit tests (`client/__tests__/floatingOverlay.test.tsx`), Sync tests (`client/__tests__/quickChatSync.test.ts`) |
| Sync Conflict Detection & Resolution Modal (#600) | `client/components/ui/SyncConflictModal.tsx`, `client/store/useSyncConflictStore.ts` | Unit tests (`client/__tests__/syncConflictStore.test.ts`, `syncConflictDetection.test.ts`, `SyncConflictModal.test.tsx`), CI pass |
| Notification Settings & Quiet Hours (#604) | `client/app/settings/notifications.tsx`, `client/utils/notificationGate.ts` | Unit tests (`client/__tests__/notificationSettings.test.tsx`, `notificationRouting.test.ts`), 50+ unit tests pass |
| Device Agent UI Polish: A11y Modal, Kill Switch, Screen Mirror, Session History (#608) | `client/components/device/`, `client/store/useDeviceSessionStore.ts`, `client/utils/deviceActionExecutor.ts` | Unit tests (`client/__tests__/deviceSessionStore.test.ts`, `killSwitch.test.ts`, `domSimplifier.test.ts`, `safetyConfirmation.test.ts`), 20+ unit tests pass |

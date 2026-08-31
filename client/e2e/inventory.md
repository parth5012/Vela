# Feature Inventory — All Shipped Vela Features

> Source: GitHub issues (all states), git log, PRODUCT.md Capabilities, docs/architecture.md Entry Points, client/app/* screens.
> Generated for Map #193, Ticket #202.

## Client Screens (expo-router)

| # | Feature | Screen Route | Source | Entry Point | Test Coverage |
|---|---------|-------------|--------|-------------|---------------|
| 1 | **Server Setup** | `/setup` | PRODUCT.md "First launch" | `app/setup.tsx` | E2E stub in runner.sh |
| 2 | **Chat (Main)** | `/` (index) | PRODUCT.md "Chat" | `app/index.tsx` | Unit: useChatStore; E2E stub |
| 3 | **Thread Management** | Drawer (within `/`) | PRODUCT.md "Threads" | `app/_layout.tsx` (drawer) | Unit: useChatStore |
| 4 | **Persona Selection** | Chat screen | PRODUCT.md "7 personas" | `utils/personas.ts` | Unit: personas.test |
| 5 | **Suggestion Starters** | Chat welcome view | PRODUCT.md "welcome view" | `app/index.tsx` | — |
| 6 | **Rich Rendering** | Chat messages | PRODUCT.md "Markdown, LaTeX, Mermaid" | `utils/messageParser.ts`, `utils/latexExtractor.ts` | Unit: messageParser tests |
| 7 | **Collapsible Blocks** | Chat messages | PRODUCT.md "thought/intent/tool/skill blocks" | `components/chat/` | Unit: CollapsibleBlock tests |
| 8 | **Safety Tier Badges** | Chat tool-call cards | Wayfinder #160 | `components/chat/` | — |
| 9 | **Markdown Viewer Overlay** | Chat message action bar | Wayfinder #152, #192 | `components/chat/` | — |
| 10 | **Message Copy/Branch/Share** | Chat message actions | PRODUCT.md | `components/chat/` | — |
| 11 | **Stop Stream / Regenerate** | Chat input area | PRODUCT.md | `app/index.tsx` | — |
| 12 | **In-App Browser** | `/browser` | PRODUCT.md "In-app browser" | `app/browser.tsx` | E2E stub |
| 13 | **Browser AI Takeover** | Browser screen | PRODUCT.md "AI takeover" | `utils/toolProxy.ts` | — |
| 14 | **Browser Overlay Concealment** | Cross-screen | Wayfinder #145 | `utils/persistentWebviewStyle.ts` | — |
| 15 | **Tasks** | `/tasks` | PRODUCT.md (planned) | `app/tasks.tsx` | E2E stub |
| 16 | **Task Progress** | `/task-progress` | Wayfinder #170-172 | `app/task-progress.tsx` | — |
| 17 | **Background Task Scheduler** | System service | Wayfinder #88, #105 | `utils/backgroundTasks.ts`, `utils/foregroundTaskRunner.ts` | — |
| 18 | **Settings Hub** | `/settings` | PRODUCT.md "Settings" | `app/settings/` | E2E stub |
| 19 | **Settings: Server & API Key** | `/settings/connection` | PRODUCT.md | `app/settings/connection.tsx` | — |
| 20 | **Settings: Cookie Viewer** | `/settings/connection` | Wayfinder #155 | `utils/cookieSync.ts` | Unit: cookieSync tests |
| 21 | **Settings: Theme & Appearance** | `/settings/appearance` | PRODUCT.md "6 themes, 8 accents" | `app/settings/appearance.tsx` | — |
| 22 | **Settings: Agent Config** | `/settings/agent` | PRODUCT.md "model name/temperature" | `app/settings/agent.tsx` | Unit: personas tests |
| 23 | **Settings: Local AI** | `/settings/local-ai` | PRODUCT.md "local LLM" | `app/settings/local-ai.tsx` | — |
| 24 | **Settings: Suggestion Starters** | `/settings/messaging` | PRODUCT.md | `app/settings/messaging.tsx` | — |
| 25 | **Settings: About & Danger Zone** | `/settings/about` | PRODUCT.md "connection reset" | `app/settings/about.tsx` | — |
| 26 | **Google Workspace Card** | `/settings/connection` | PRODUCT.md "Google Workspace card" | `components/oauth/` | — |
| 27 | **OAuth Callback Screen** | `/oauth-callback` | Wayfinder #88 | `app/oauth-callback.tsx` | — |
| 28 | **Briefing Settings** | `/briefing` | Wayfinder #121-129 | `app/briefing.tsx` | — |
| 29 | **Briefing History View** | `/briefing` | Wayfinder #129 | `app/briefing.tsx` | — |
| 30 | **Device Agent** | System service | Wayfinder #100-105 | `utils/deviceActionExecutor.ts` | — |
| 31 | **Device Agent Accessibility** | System service | Wayfinder #101-102 | `utils/permissionManager.ts` | — |
| 32 | **Device Agent Safety Tiers** | Device actions | Wayfinder #103, #177 | `utils/safetyManager.ts` | — |
| 33 | **Device SSE Tool Bridge** | Device agent | Wayfinder #104 | `utils/deviceActionExecutor.ts` | — |
| 34 | **Offline Chat Sync** | System (background) | Wayfinder #138-141 | `utils/offlineSync.ts`, `utils/syncManager.ts` | — |
| 35 | **FCM Push Notifications** | System (background) | Wayfinder #130-137 | `utils/pushRegistration.ts`, `utils/notificationRouting.ts` | — |
| 36 | **Local Model Export/Import** | Settings > Local AI | Wayfinder | `utils/localLlm.ts` | — |
| 37 | **RAM Auto-Detection** | Settings > Local AI | Wayfinder | `utils/ramDetection.ts` | — |
| 38 | **Stable Diffusion Module** | Native module | Wayfinder | `utils/stableDiffusion.ts` | — |
| 39 | **Permission Manager** | Device agent | Wayfinder #158 | `utils/permissionManager.ts` | — |
| 40 | **Prompt Compiler** | Chat | — | `utils/promptCompiler.ts` | — |
| 41 | **XML Healer** | Chat messages | — | `utils/xmlHealer.ts` | — |
| 42 | **Source Parser** | Chat messages | — | `utils/sourceParser.ts` | — |
| 43 | **History Manager** | Chat | — | `utils/history.ts` | — |

## Backend Entry Points (FastAPI)

| # | Feature | Endpoint | Source | Test Coverage |
|---|---------|----------|--------|---------------|
| 44 | **Health Check** | `GET /health` | architecture.md | Backend pytest |
| 45 | **Chat Message (SSE)** | `POST /chat/message` | architecture.md | Backend e2e/SSE tests |
| 46 | **Thread CRUD** | `GET/POST/DELETE /chat/threads` | architecture.md | Backend pytest |
| 47 | **Thread Branch** | `POST /chat/threads/branch` | architecture.md | — |
| 48 | **Thread Truncate** | `POST /chat/threads/{id}/truncate` | architecture.md | — |
| 49 | **Google OAuth** | `GET /oauth/google/authorize`, `GET /oauth/callback` | architecture.md | — |
| 50 | **OAuth Token Management** | `POST /oauth/token`, `POST /oauth/token/revoke`, `GET /oauth/token/status` | architecture.md | — |
| 51 | **Telegram Webhook** | `POST /webhooks/telegram` | architecture.md | — |
| 52 | **CarbonVoice Webhook** | `POST /webhooks/carbonvoice` | architecture.md | — |
| 53 | **WebView Response** | `POST /chat/webview/response` | architecture.md | — |
| 54 | **Tools Manifest** | `GET /api/tools/manifest` | architecture.md | — |
| 55 | **Tool Invoke** | `POST /api/tools/invoke` | architecture.md | — |
| 56 | **Sync Pull/Push** | `GET /api/sync/pull`, `POST /api/sync/push` | architecture.md | — |
| 57 | **Consolidate** | `POST /consolidate` | architecture.md | Backend pytest |
| 58 | **Device Agent Registry** | Backend agent registry | Wayfinder #100 | Backend pytest |
| 59 | **FCM Send** | Backend firebase-admin | Wayfinder #134 | — |
| 60 | **Briefing Cron** | Backend cron/consolidate | Wayfinder #126 | — |
| 61 | **Briefing Config API** | Backend API | Wayfinder #127 | — |

## E2E Verification Scope (Client-only, emulator-5554)

These are the features that need E2E verification via the `vela-e2e-testing` harness:

| E2E # | Feature | Lane | Fixture | Oracle |
|--------|---------|------|---------|--------|
| E1 | Server Setup (empty validation, invalid ping, valid connection) | critical-path | `setup.json` | `setup.md` |
| E2 | Chat (persona switch, suggestion starter, SSE streaming) | critical-path | `chat.json` | `chat.md` |
| E3 | Thread Management (create, switch, pin, rename) | critical-path | `chat.json` | `chat.md` |
| E4 | Rich Rendering (Markdown, LaTeX, Mermaid, code blocks) | critical-path | `chat.json` | `chat.md` |
| E5 | Collapsible Blocks (thought, intent, tool, skill) | critical-path | `chat.json` | `chat.md` |
| E6 | Tasks (create, toggle, run now, SQLite hydration) | extended | `tasks.json` | `tasks.md` |
| E7 | In-App Browser (navigation, URL bar, overlay concealment) | extended | `browser.json` | `browser.md` |
| E8 | Settings Hub (sub-screen navigation) | extended | `settings.json` | `settings.md` |
| E9 | Settings: Theme & Appearance | extended | `settings.json` | `settings.md` |
| E10 | Settings: Agent Config | extended | `settings.json` | `settings.md` |
| E11 | Local AI (model selection, download, mock fallback) | parallel | `local-ai.json` | `local-ai.md` |
| E12 | Device Agent (accessibility, safety tiers, SSE bridge) | parallel | `device-agent.json` | `device-agent.md` |
| E13 | Offline Chat Sync (queue, flush-on-reconnect) | parallel | `offline.json` | `offline.md` |
| E14 | FCM Push Notifications (registration, deep-link) | parallel | `fcm.json` | `fcm.md` |
| E15 | Google Workspace OAuth (connect, disconnect, scope badges) | extended | `settings.json` | `settings.md` |
| E16 | Briefing (settings, watch items, history) | extended | `chat.json` | `chat.md` |
| E17 | Message Actions (copy, branch, share, markdown viewer) | critical | `chat.json` | `chat.md` |
| E18 | Safety Tier Badges (tool-call cards) | critical | `chat.json` | `chat.md` |
| E19 | Cookie Viewer | extended | `settings.json` | `settings.md` |
| E20 | Task Progress (states, theming) | extended | `tasks.json` | `tasks.md` |

## Summary

- **Total shipped features**: 61 (43 client, 18 backend)
- **E2E verification targets**: 20 client-surface features across 3 lanes
- **Backend-only features**: Not in E2E scope (covered by backend pytest)
- **Gaps**: Some features (Stable Diffusion, Prompt Compiler, XML Healer) are internal utilities, not user-facing surfaces — excluded from E2E scope

# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

A single Owner (single-tenant, self-hosted) — a power user who runs their own Vela backend and uses the Android client as the primary designed surface. The Owner configures the server URL and API key themselves at first launch, hosts their own instance, and uses Vela for research, writing, coding help, email/calendar management, and task automation. They switch between cloud AI and on-device local models. Greeting name for the welcome view is undecided.

## Product Purpose

Vela is a personal AI assistant: a single-tenant, self-hosted assistant backend (FastAPI + LangGraph) with a custom Android client. A Supervisor Agent classifies intents and routes them to tools (web search, code execution, Gmail, Calendar, browser automation) or multi-turn skills (brainstorming, research, coding), backed by server-side semantic memory (Supabase pgvector). The client's job is to make that agent feel immediate and trustworthy: streamed responses, rich rendering (Markdown, LaTeX, Mermaid), conversation threads, an in-app browser the agent can drive, and Google Workspace access — all over the Owner's own server. Success means the Owner can delegate real work to the assistant on their own infrastructure and see exactly what it did.

## Positioning

A single-tenant, self-hosted assistant whose reasoning runs on the Owner's own backend rather than a vendor-managed service. The meaningfully different mechanism is the Supervisor Agent graph: one agent coordinating tools, multi-turn skills, persistent semantic memory, and a nightly self-improvement loop that refines its own prompts, while a custom Android client renders the agent's thought, intent, tool calls, and skill executions transparently.

## Operating Context

- The Owner hosts the Vela backend themselves (self-host-only deployment; single-tenant). Render blueprint and local dev (`uv run uvicorn agent.main:app --reload`) are the documented paths.
- First launch of the Android client prompts for server URL and API key; validation happens via `GET /health` with Bearer auth.
- The Android client connects over the network to the Owner's backend; responses stream over SSE (`content` then `done` chunks).
- Chat messages may carry XML-like segments the client parses and renders: thought, intent, tool calls, skill executions, and web-search sources.
- The client can switch between cloud mode and on-device local LLM mode (LiteRT `.task` bundles via MediaPipe; GGUF is never supported).
- Google Workspace access runs through an OAuth flow with an authentication gate on the backend and explicit client-side approval for sensitive browser actions.

## Capabilities and Constraints

Confirmed functionality (client surface):
- Threads: create, delete, switch, pin, rename, branch, truncate; thread list in a drawer sorted pinned-first then by update time.
- Chat: streaming responses with typing indicator, stop-stream, regenerate, message copy/branch/share, welcome view with customizable suggestion starter cards.
- Rich rendering: Markdown, inline/block LaTeX (KaTeX in WebView), Mermaid diagrams, fenced code blocks with copy button, collapsible thought/intent/tool/skill blocks.
- 7 personas (personal assistant, teacher, analyst, prompt builder, researcher, coder, brainstormer), selectable per thread.
- In-app browser with manual navigation and AI takeover; sensitive actions (password/email/payment fill, form submit) require Owner approval.
- Google Workspace card: connect/disconnect, scope badges (Gmail, Calendar), status indicator.
- Settings: server connection, 6 dark themes, 8 accent colors, font size presets, model name/temperature/system prompt, local LLM model selection with download progress, suggestion starter manager, connection reset.
- Local on-device LLM with honest mock fallback (mock output is labeled as mock, never mistaken for a running model).

Confirmed constraints:
- Android-only client (Expo SDK 57 / React Native 0.86, expo-router). Portrait orientation.
- Backend is single-tenant, self-host-only; external/client requests authenticate with a static Bearer API key.
- Local model format is LiteRT `.task` only; MediaPipe tasks-genai 0.10.24+ is required (older versions crash natively).
- Accessibility: WCAG AA contrast on the dark themes is a confirmed requirement.
- Platform guidance: Material Design 3 governs structure, navigation, and interaction; the current app uses a drawer + 48dp-class touch targets — treat that as incumbent evidence, not a binding decision.

Undecided (recorded, not invented):
- Greeting user name in the welcome view.
- Planned but not committed future features: on-device image generation, multimodal chat both directions, task management / on-device cron, push notifications, smart auto-configuration, device agent, voice input, floating overlay, offline resilience.

## Brand Commitments

- Name: Vela. App display name "Vela - Your Personal Assistant" (dev variant "Vela (Dev)").
- Package/bundle id: `com.parth5012.client` (dev: `com.parth5012.client.dev`).
- Product icon assets exist in `client/assets/`; the Android adaptive icon config lives in `client/app.config.js`.
- **Visual direction (committed): Aurora** — a night-sky glass world for the Android client. Dark-only, one glass language with six theme atmospheres (the existing theme IDs: `deep`, `slate`, `cyberpunk`, `oled`, `dracula`, `nordic`) and eight accent "energies" (the existing accent IDs). Model: theme = atmosphere (sky, glass, borders, text), accent = energy (aurora gradient tinting send button, streaming stripe, user bubble, glow, active states). No drop-shadow reliance; glass blur + thin borders instead. System sans for UI, serif (Georgia-class) reserved for greeting/display moments. Spec: `docs/design-themes.html`.
- **Settings reorganized into subcategories (committed)**: the single scrolling settings screen becomes a Material 3 settings stack — an index of grouped categories (Connection & Accounts, Appearance, Agent, Local AI, Messaging & Data, About & Danger), each row opening its own screen via expo-router folder routes (`app/settings/index.tsx` + one screen per group). Spec and implementation notes: `docs/design-themes.html`.
- `docs/vela_client_ui_redesign_spec.md` remains a surface/feature inventory and evidence; its theme/accent/font/glassmorphism specifics were a proposal and are superseded by Aurora.

## Evidence on Hand

- `docs/vela_client_ui_redesign_spec.md` — a complete redesign proposal (screen-by-screen, component library, theme/accent systems). Treated as evidence of surface inventory and planned features, not as visual authority.
- `CONTEXT.md` (root and `client/`) — confirmed domain model and hard-won technical constraints (e.g., LiteRT-only local models, tasks-genai version floor, callback handling).
- `docs/architecture.md` — current architecture, API surface, commands.
- Working client and backend codebases with tests (`npm test`, `uv run python -m pytest -v`).
- Absent, must not be fabricated: real user testimonials, usage statistics, pricing, or a user-provided name.

## Product Principles

1. The Owner's data stays on the Owner's infrastructure; single-tenant, self-hosted is the default and the selling point.
2. The agent is the product; the client is a thin but rich window onto it — streaming, transparency of reasoning, and honest capability states over gimmicks.
3. Trust is earned by disclosure: the assistant shows its thought, intent, tool calls, and skill executions, and asks before sensitive actions.
4. Capability honesty: mock/local modes and auth failures are labeled clearly; a broken model is never presented as a working one.
5. The Owner configures everything important — connection, personas, models, prompts, themes — and the defaults must always work before the controls do.

## Accessibility & Inclusion

- WCAG AA contrast ratio is a confirmed requirement on the dark themes used by the app.
- Android platform guidance (Material 3 structure/navigation/interaction, system back gesture, touch targets, edge-to-edge insets, dynamic color, dark theme as first-class) applies to all design work.

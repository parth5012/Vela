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
- The client can switch between cloud mode and on-device local LLM mode. Three engines, three non-interchangeable formats: LiteRT `.task` via MediaPipe tasks-genai, GGUF via llama.rn, and Cactus `.cact` via the static Needle engine.
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
- Local on-device LLM with honest mock fallback (mock output is labeled as mock, never mistaken for a running model). For `.cact`/Needle models the Settings → Local AI engine pill reads `Accelerated (native)` or `Mock Fallback`, and a mock build refuses to load a `.cact` model instead of faking output.
- On-device JSON extraction (Settings → Local AI → JSON Extraction): the Owner's JSON schema is passed as the only tool, so the constrained decode produces schema-conformant JSON locally; an empty `function_calls[]` (model refusal) is reported distinctly from `parse_failure`.

Confirmed constraints:
- Android-only client (Expo SDK 57 / React Native 0.86, expo-router). Portrait orientation.
- Backend is single-tenant, self-host-only; external/client requests authenticate with a static Bearer API key.
- Local model formats are engine-specific: MediaPipe accepts LiteRT `.task` only and requires tasks-genai 0.10.24+ (older versions crash natively); llama.rn accepts GGUF; the Needle engine accepts `.cact`. Exactly two Needle models ship — `Needle-2 45M` (2048 context) and `Needle-3 (20-layer)` (8192 context) — from `Cactus-Compute/needle2|needle3`; Needle-1 (26M) is out of scope (decided in wayfinder #290), so "three models" is wrong.
- Accessibility: WCAG AA contrast on the dark themes is a confirmed requirement.
- Platform guidance: Material Design 3 governs structure, navigation, and interaction; the current app uses a drawer + 48dp-class touch targets — treat that as incumbent evidence, not a binding decision.

Undecided (recorded, not invented):
- Greeting user name in the welcome view.
- Confidence threshold UX (`act` / `confirm` / `refuse`) for local tool calls — not yet specified (`LOCAL_TOOL_CALL_CONFIDENCE_THRESHOLD = 0.5` is a flagged placeholder, not a tuned value).
- Planned but not committed future features: on-device image generation, multimodal chat both directions, task management / on-device cron, push notifications, smart auto-configuration, device agent, voice input, floating overlay, offline resilience.

Not yet verified (recorded, not claimed):
- The native Needle path end to end. No Android NDK/SDK toolchain was available while building this map, so NDK compile/link, Gradle packaging, and on-device load are unproven — host-side CMake configure and `g++ -fsyntax-only` prove configure/syntax only. Steps are in the on-device plan below.
- The `needle_embed` paraphrase quality gate for hybrid message search is UNRUN (needs a device); its UI half is parked — there is no search affordance and `searchMessages()` has no production caller. Hybrid merge weights (0.5/0.5) are PLACEHOLDER.
- Ladder slice sizes for 4/8/12-layer Needle-3 variants — unverified and out of scope; the "8–29 MB" claim is not used anywhere in the product.
- Kotlin/JNI changes from the extraction screen and `embed()` — not compile-verified without the NDK.

## On-Device Verification Plan

Not yet run. This is exactly what a human must execute to prove the native Needle path, because the environment used to build this map has no Android toolchain (see "Not yet verified" above). Steps 1–3 prove the build; 4–7 prove the runtime; 8 is the outstanding gate for wayfinder #299.

1. `cd client && npx expo prebuild --clean` — regenerate the gitignored `android/` tree.
2. `cd client/android && ./gradlew assembleDebug` — the first CMake configure runs `modules/needle/scripts/fetch-engine.js`, which downloads the pinned `libneedle.a` archives into `modules/needle/android/engine/<model>/<abi>/` and re-verifies every SHA256 against `modules/needle/scripts/engine.lock.json`. A pin mismatch, missing `node`, or unsupported ABI fails closed to `HAVE_NEEDLE_ENGINE=0` (honest mock stub still builds). Engine selection is link-time, default `needle3` (`-DNEEDLE_ENGINE_MODEL=needle2` to link needle2 instead).
3. `adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk` (dev package `com.parth5012.client.dev`). Installing the app itself needs no approval; installing anything else does (see policy below).
4. Settings → Local AI: the engine pill must read **⚡ Needle Engine: Accelerated (native)**. If it reads **Mock Fallback**, the engine was not linked — stop there and diagnose; do not treat mock text as model output.
5. Download and load `Needle-2 45M`, send a chat turn, confirm real model output (no `[Mock mode — the local model is NOT running]` prefix). Repeat with `Needle-3 (20-layer)`.
6. Settings → Local AI → JSON Extraction (`/settings/extract`): run a small schema end to end; confirm schema-conformant JSON and that an empty `function_calls[]` (refusal) is reported distinctly from `parse_failure`.
7. Exercise a `.cact` tool-call turn so the envelope path (`function_calls`, `reasoning`, `confidence`) is observed on-device, not just in jest.
8. Wayfinder #299 gate (currently UNRUN): run the paraphrase quality gate for `needle_embed` / hybrid message search on-device. The search UI half stays parked until this passes.

Policy and hardware limits (do not work around them):
- **No `androidTest` / instrumentation APK without explicit approval.** `connectedAndroidTest` installs a companion package (`com.parth5012.client.dev.test`); per `client/AGENTS.md` physical-device policy this requires an explicit human yes first. This plan deliberately installs nothing but the app.
- **MIUI blocks `adb shell input`** (SecurityException: INJECT_EVENTS), so on-device UI automation is unavailable — a human drives steps 4–8. Read-only inspection (`adb logcat`, `pm list packages`, `run-as ... ls`) needs no approval.

## Brand Commitments

- Name: Vela. App display name "Vela - Your Personal Assistant" (dev variant "Vela (Dev)").
- Package/bundle id: `com.parth5012.client` (dev: `com.parth5012.client.dev`).
- Product icon assets exist in `client/assets/`; the Android adaptive icon config lives in `client/app.config.js`.
- **Visual direction (committed): Aurora** — a night-sky glass world for the Android client. Dark-only, one glass language with six theme atmospheres (the existing theme IDs: `deep`, `slate`, `cyberpunk`, `oled`, `dracula`, `nordic`) and eight accent "energies" (the existing accent IDs). Model: theme = atmosphere (sky, glass, borders, text), accent = energy (aurora gradient tinting send button, streaming stripe, user bubble, glow, active states). No drop-shadow reliance; glass blur + thin borders instead. System sans for UI, serif (Georgia-class) reserved for greeting/display moments. Spec: `docs/design-themes.html`.
- **Settings reorganized into subcategories (committed)**: the single scrolling settings screen becomes a Material 3 settings stack — an index of grouped categories (Connection & Accounts, Appearance, Agent, Local AI, Messaging & Data, About & Danger), each row opening its own screen via expo-router folder routes (`app/settings/index.tsx` + one screen per group). Spec and implementation notes: `docs/design-themes.html`.
- `docs/vela_client_ui_redesign_spec.md` remains a surface/feature inventory and evidence; its theme/accent/font/glassmorphism specifics were a proposal and are superseded by Aurora.

## Evidence on Hand

- `docs/vela_client_ui_redesign_spec.md` — a complete redesign proposal (screen-by-screen, component library, theme/accent systems). Treated as evidence of surface inventory and planned features, not as visual authority.
- `CONTEXT.md` (root and `client/`) — confirmed domain model and hard-won technical constraints (e.g., per-engine model formats and the tasks-genai version floor, mock-honesty rules, callback handling).
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

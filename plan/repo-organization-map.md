# Repository Organization Map

This file is the placement contract for source files.
Update it when folder ownership or dependency boundaries change.

Source: tailored from repo-quality-orchestrator template for Vela Expo client (2026-10-05).

## Global principles

- Prefer small focused files and cohesive modules (<100 LOC ideal, <50 for pure logic).
- Keep dependency direction one-way: app -> components -> hooks/store -> utils -> db/lib.
- Avoid circular dependencies across folders.
- Put shared utilities in explicitly shared locations only (utils/ for pure, components/ui/ for UI primitives).
- Public API preservation: do not change export paths without approval.

## Folder contracts

### `client/app/*` (expo-router routes + screens)

- Purpose: route entrypoints, screen composition, navigation wiring only.
- Include: route files, screen components that compose store/hooks/components, light param parsing.
- Exclude: business logic, direct DB/SQL, provider fetch, heavy parsing (>100 LOC logic belongs in utils/ or hooks/).
- Allowed imports: `components/*`, `hooks/*`, `store/*`, `utils/*`, `db/*` (via repositories only, no raw SQL in app/).
- Disallowed imports: other route internals, `__tests__` helpers, native `modules/*` directly (go via utils/ adapter).
- Ownership notes: screen owners; oversized screens (>500 LOC, e.g. app/index.tsx 2235, local-ai.tsx 1407) must split into components + hooks.

### `client/components/*`

- Purpose: reusable UI (chat/, ui/, oauth/), presentational + minimal local state.
- Include: BubbleFooter, RichText, MarkdownViewerOverlay, settingsKit, SafetyDialog, etc.
- Exclude: data fetching, navigation decisions, DB writes, provider keys.
- Allowed imports: `utils/theme`, `store/*` (read-only selectors preferred), same feature folder, `hooks/*` for behavior.
- Disallowed imports: `db/*` direct writes, `app/*` routes, other feature internals except via ui/ primitives.
- Ownership notes: UI kit changes require visual + test compatibility checks.

### `client/hooks/*`

- Purpose: React behavior glue (useAgents, useAurora) bridging store/utils to components.
- Include: data subscriptions, effects, callbacks.
- Exclude: pure parsing (goes to utils/), persistence SQL (goes to db/), UI markup.
- Allowed imports: `store/*`, `utils/*`, `db/*` via repositories.
- Disallowed imports: `app/*`, `components/*` internals.
- Ownership notes: keep hooks small, single responsibility, testable without rendering.

### `client/store/*` (zustand/client state)

- Purpose: client state (useChatStore 505 LOC, useConfigStore 517 LOC, useBrowserStore, useSafetyStore, etc.).
- Include: slices, selectors, actions with explicit types.
- Exclude: side-effectful IO (fetch, SQLite) except via injected utils/db adapters; no JSX.
- Allowed imports: `utils/*` pure helpers, `db/*` repositories (async actions only).
- Disallowed imports: `app/*`, `components/*`, `hooks/*`.
- Ownership notes: state shape changes are public API - require approval + migration check.

### `client/utils/*` (domain + infra helpers)

- Purpose: pure logic + thin adapters (messageParser, jsonExtraction, safetyManager, providers/, toolRegistry, localLlm 713 LOC, localAgentLoop 511 LOC, customModelStorage 567 LOC, syncManager, cookieSync, etc.).
- Include: parsers, formatters, providers/fetch, task runners, schedulers.
- Exclude: JSX, route definitions, raw SQL schema (lives in db/schema.ts).
- Allowed imports: low-level npm/expo, `./providers/*` siblings, `db/*` repositories where needed; utils must not import from `app/*` or `components/*`.
- Disallowed imports: `app/*`, `components/*`, `store/*` (pass state as args instead - explicit deps).
- Ownership notes: enforce strict public APIs; files >250 LOC flagged for split (see oversized policy).

### `client/db/*` (drizzle/SQLite persistence)

- Purpose: schema + repositories (schema.ts, client.ts, chatRepository, agentRepository, messageSearch 393 LOC, syncQueue, etc.).
- Include: table defs, migrations wiring, typed queries.
- Exclude: UI, parsing, provider logic, navigation.
- Allowed imports: drizzle/expo-sqlite, `./schema`, shared types only.
- Disallowed imports: `app/*`, `components/*`, `store/*`, `utils/providers/*`.
- Ownership notes: schema changes need migration + test (messageSearch.test.ts, tasksSchema.test.ts).

### `client/modules/*` (native bridges)

- Purpose: expo native module declarations (device-agent, needle, stable-diffusion - index.ts + index.d.ts).
- Include: typed bridges only.
- Exclude: business logic (wrap in utils/ adapter).
- Allowed imports: expo/native runtime only.
- Disallowed imports: app/components/store/db.
- Ownership notes: interface changes are breaking - explicit approval required.

### `client/__tests__/*` + `**/*.test.*` + `client/e2e/*`

- Purpose: jest unit/integration + e2e specs, helpers (sqliteMigrations, standaloneRunner).
- Include: all test doubles, fixtures.
- Exclude: production code (no imports from tests into prod).
- Allowed imports: anything (mocks for externals required).
- Ownership notes: keep AAA pattern, mock externals.

## Placement review checklist

- Does this file match the folder purpose?
- Is it importing only allowed layers?
- Is related code grouped in the same module area?
- Could this module be moved to a narrower scope?
- Is public import path preserved?

## Move policy

- Prefer local moves over broad tree rewrites.
- Preserve public import paths unless explicitly approved.
- Batch moves in small groups (max 10 files), then run full verification: lint:fix, typecheck, build, test.

## Change log

- 2026-10-05: Initial map created for Vela client/ (Expo RN + TS). Flagged critical oversized: app/index.tsx (2235), app/settings/local-ai.tsx (1407), app/tasks.tsx (836), app/setup.tsx (780), utils/localLlm.ts (713), app/browser.tsx (639).

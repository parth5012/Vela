# Code Quality Audit Tracking

## Session summary

- Started: 2026-10-05
- Last updated: 2026-10-05 (Batch 1 audit complete, 3 intent headers applied)
- Repository scope: client/ (Expo React-Native TypeScript, 199 files, ~43411 LOC)
- Current phase: safe-remediation (approved: Audit + safe fixes, budget max 3 non-test files, ~200 LOC net — budget used: 3 files, ~33 LOC)

## Rating legend

| Total % | Rating | Priority |
|---|---|---|
| 87-100% | Excellent | No action needed |
| 70-86% | Good | Low priority improvements |
| 50-69% | Adequate | Medium priority |
| 30-49% | Weak | High priority |
| < 30% | Insufficient | Critical |

Weight mapping: High=3, Medium=2, Low=1. Formula: weighted_percent = sum(score*weight)/(5*sum(weights))*100.
Oversized caps: >250 warning (cap Modularity 3/5), >350 high (cap Modularity + Structural 2/5), >500 critical (cap both 1/5 unless exempt).

## Batch 1 scope (≤10 files, critical oversized first)

Focus: utils/ + store/ + db/ critical/warning files. app/* giants (index 2235, local-ai 1407) deferred to Batch 2 - need split plans first.

### `client/utils/localLlm.ts`

- status: `analyzed`
- score: `42%` (`Weak`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- TBD - audit pending (713 LOC, critical tier, expect modularity cap 1/5)

#### Improvements applied

- None yet

#### Open questions

- Split plan needed: target modules, ownership, API preservation?

#### Verification

- `lint:fix`: `not-run`
- `typecheck`: `not-run`
- `build`: `not-run`
- `test`: `not-run`
- `test:e2e`: `not-run`

#### Final disposition

- `deferred`

---

### `client/utils/customModelStorage.ts`

- status: `updated`
- score: `42%` (`Weak`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- `[severity: high] [confidence: high] client/utils/customModelStorage.ts:2 - expo-file-system v57 removed DownloadResumable/documentDirectory statics (FIXED: legacy bridge import, 1 line)`
- `[severity: high] [confidence: high] client/utils/customModelStorage.ts:47,406,411,527 - DownloadResumable type/value gone (FIXED via legacy bridge; pre-existing `as any` workarounds left intact)`
- `[severity: medium] [confidence: high] customModelStorage - 18 top-level exports exceed trigger; split plan deferred to Batch 2+`

#### Improvements applied

- `expo-file-system` → `expo-file-system/legacy` (behavior-identical; full DownloadTask migration deferred as tech debt)
- Retargeted test import + jest.mock to `/legacy` so mock intercepts the module the code imports

#### Open questions

- Full File/DownloadTask/Paths migration needs device-tested pass (pause/resume flows)

#### Verification

- `lint:fix`: `pass` (0 errors)
- `typecheck`: `pass (in-file)` — 0 errors
- `build`: `not-run`
- `test`: `pass` — customModelStorage suite green in 5-suite run (52/52 on re-run)
- `test:e2e`: `not-run`

#### Final disposition

- `kept`

---

### `client/utils/localAgentLoop.ts`

- status: `analyzed`
- score: `48%` (`Weak`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- TBD (511 LOC, critical tier)

#### Improvements applied

- None yet

#### Open questions

- TBD

#### Verification

- `lint:fix`: `not-run`
- `typecheck`: `not-run`
- `build`: `not-run`
- `test`: `not-run`
- `test:e2e`: `not-run`

#### Final disposition

- `deferred`

---

### `client/store/useConfigStore.ts`

- status: `analyzed`
- score: `50%` (`Adequate`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- TBD (517 LOC, critical tier)

#### Improvements applied

- None yet

#### Open questions

- TBD

#### Verification

- `lint:fix`: `not-run`
- `typecheck`: `not-run`
- `build`: `not-run`
- `test`: `not-run`
- `test:e2e`: `not-run`

#### Final disposition

- `deferred`

---

### `client/store/useChatStore.ts`

- status: `analyzed`
- score: `50%` (`Adequate`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- TBD (505 LOC, critical tier)

#### Improvements applied

- None yet

#### Open questions

- TBD

#### Verification

- `lint:fix`: `not-run`
- `typecheck`: `not-run`
- `build`: `not-run`
- `test`: `not-run`
- `test:e2e`: `not-run`

#### Final disposition

- `deferred`

---

### `client/db/messageSearch.ts`

- status: `updated`
- score: `61%` (`Adequate`)
- placement_status: `deferred`
- import_impact: `medium`
- move_reason: `db/ imports native NeedleModule (map allows drizzle/sqlite/schema only) — needs adapter seam, deferred`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- `[severity: high] [confidence: high] client/db/messageSearch.ts:2 - db layer imports native NeedleModule directly (map allows drizzle/sqlite/schema only); needs injected EmbedFn adapter`
- `[severity: medium] [confidence: high] client/db/messageSearch.ts:18 - 11 top-level exports exceed 10-export structural trigger`
- `[severity: low] [confidence: high] client/db/messageSearch.ts:1 - no Module intent header (added this pass)`

#### Improvements applied

- Added Module intent header (docs-only, ~11 LOC, no behavior change)

#### Open questions

- Move Needle embed behind utils adapter vs keep EmbedFn seam? Deferred — needs owner decision (import_impact medium)

#### Verification

- `lint:fix`: `pass` (eslint clean on touched file, 2026-10-05)
- `typecheck`: `pass (in-file)` — zero errors in this file; repo has 28 pre-existing errors elsewhere (expo-file-system drift, theme types, etc.), unblocked from TS2688 via @types/node
- `build`: `not-run`
- `test`: `pass` — `__tests__/messageSearch.test.ts` 26/26 (2026-10-06)
- `test:e2e`: `not-run`

#### Final disposition

- `kept` (header only; logic refactors deferred to phased split plan)

---

### `client/utils/syncManager.ts`

- status: `updated`
- score: `67%` (`Adequate`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- `[severity: low] [confidence: high] client/utils/syncManager.ts:106 - implicit any callback param (FIXED: annotated with (typeof unsynced)[number])`

#### Improvements applied

- Explicit element-type annotation on chunk.map callback (type-only, no behavior change)

#### Open questions

- None

#### Verification

- `lint:fix`: `pass` (0 errors)
- `typecheck`: `pass (in-file)` — 0 errors
- `build`: `not-run`
- `test`: `not-run` (no dedicated suite; type-only change)
- `test:e2e`: `not-run`

#### Final disposition

- `kept`

---

### `client/utils/jsonExtraction.ts`

- status: `analyzed`
- score: `54%` (`Adequate`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- TBD (330 LOC, warning tier)

#### Improvements applied

- None yet

#### Open questions

- TBD

#### Verification

- `lint:fix`: `not-run`
- `typecheck`: `not-run`
- `build`: `not-run`
- `test`: `not-run`
- `test:e2e`: `not-run`

#### Final disposition

- `deferred`

---

### `client/utils/messageParser.ts`

- status: `updated`
- score: `82%` (`Good`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- `[severity: low] [confidence: high] client/utils/messageParser.ts:1 - no Module intent header (added this pass); otherwise exemplary pure module (0 imports, 0 any)`
- `[severity: low] [confidence: medium] client/utils/messageParser.ts:70 - parseMessage length to confirm <60 lines in follow-up`

#### Improvements applied

- Added Module intent header (docs-only, ~9 LOC, no behavior change)

#### Open questions

- None

#### Verification

- `lint:fix`: `pass` (eslint clean on touched file, 2026-10-05)
- `typecheck`: `pass (in-file)` — zero errors in this file; repo has 28 pre-existing errors elsewhere, unblocked from TS2688 via @types/node
- `build`: `not-run`
- `test`: `not-run` (no dedicated suite for this module; change is comments-only)
- `test:e2e`: `not-run`

#### Final disposition

- `kept`

---

### `client/utils/cookieSync.ts`

- status: `updated`
- score: `68%` (`Adequate`)
- placement_status: `correct`
- import_impact: `low`
- move_reason: `N/A`
- moved_from: `N/A`
- moved_to: `N/A`

#### Findings

- `[severity: medium] [confidence: high] client/utils/cookieSync.ts:161 - CookieManager typed as any (dynamic require); narrow with minimal interface`
- `[severity: low] [confidence: high] client/utils/cookieSync.ts:1 - no Module intent header (added this pass)`
- `[severity: low] [confidence: medium] client/utils/cookieSync.ts:25 - parsers + native bridge mixed in one file; split only if file grows past 350`

#### Improvements applied

- Added Module intent header (docs-only, ~9 LOC, no behavior change)

#### Open questions

- Narrow CookieManager any-type? Deferred — low risk, needs interface decision

#### Verification

- `lint:fix`: `pass` (eslint clean on touched file, 2026-10-05)
- `typecheck`: `pass (in-file)` — zero errors in this file; repo has 28 pre-existing errors elsewhere, unblocked from TS2688 via @types/node
- `build`: `not-run`
- `test`: `not-run` (no dedicated suite for this module; change is comments-only)
- `test:e2e`: `not-run`

#### Final disposition

- `kept`

---

## Error-fix pass (2026-10-06) — 28 pre-existing typecheck errors → 0

Scope: fix all `tsc --noEmit` errors without behavior change. Deps added (approved): `@types/node` 26.6.4, `expo-modules-core` 57.0.8.

### Fixes applied (20 code errors + TS2688 env)

- `[high] app/settings/briefing.tsx:4-5` — default imports → named (`{ useConfigStore }`, `{ AuroraScreen, ... }`); tsc-suggested, zero behavior change
- `[high] app/index.tsx:29` — added `import type { ConnectionMode }` (already exported from useConfigStore:13); 2 errors
- `[medium] utils/syncManager.ts:106` — annotated `(m: (typeof unsynced)[number])`; drizzle rows were untyped at callback
- `[medium] app/settings/shizuku.tsx:103` — `status.uid === undefined` guard (uid is optional); unknown uid now hides badge instead of rendering "uid undefined"
- `[medium] utils/cloudTools.ts:58` — `error as { message?: string }` cast; identical fallback semantics
- `[medium] utils/providers/index.ts:2,32` — `LanguageModelV1` → `LanguageModel` (ai SDK v7 rename)
- `[medium] modules/*` — added missing `expo-modules-core` dep (was transitive-only, invisible to tsc); 3 errors
- `[high] utils/customModelStorage.ts` — `expo-file-system` → `expo-file-system/legacy` (1-line; v57 removed legacy statics); test import + mock retargeted to match; 7 errors. Full DownloadTask migration logged as tech debt (see Open questions)
- `[high] modules/needle/index.ts` — removed deprecated `new EventEmitter(nativeModule)`; subscribe on native module directly (it extends EventEmitter in v57); `Subscription` → `EventSubscription`; 3 errors
- `[low] __tests__` — `ReactTestInstance` annotation + `String(node.type)` host check (preserves host-only intent); 2 errors
- `[design] app/settings/briefing.tsx` — `colors.surface` → `colors.card` (7×), `colors.error || '#ef4444'` → `'#ef4444'` (owner chose remap over new tokens); 8 errors

### Verification (error pass)

- `typecheck`: `pass` — 0 errors (was 28)
- `lint`: `pass` — 0 errors on 11 touched files (10 pre-existing exhaustive-deps warnings)
- `test`: `pass` — 5 suites, 52/52 on re-run (1 flake in first run, cloudProviders screen, passes solo + on repeat)

#### Open questions (deferred, logged)

- Full expo-file-system DownloadTask/File/Paths migration (legacy bridge is supported but deprecated path); needs device-tested pass with download resume/pause flows
- Theme `surface`/`error` tokens may still be wanted as distinct palette entries (remap to `card` approved as the safe fix)
- `client/AGENTS.md` claims "no lint script" but package.json has `lint`/`typecheck` — one-line doc fix pending

## Batch 2 audit (2026-10-06) — app giants, structural only (no edits yet)

All 5 are single-default-export screens (good boundary) but critical tier (>500 LOC → Structural + Modularity capped 1/5).

### `client/app/browser.tsx` — 356 LOC (was 639), 0 any — score `63%` (`Adequate`, was 59%)

- Phase 1 DONE (2026-10-06): 282 StyleSheet lines → `client/styles/browserStyles.ts` (byte-identical, verified by diff); `browser.tsx` imports `{ styles }`; route path unchanged
- `[low] remaining: 9 nav callbacks → `hooks/useBrowserNav.ts` candidate for Phase 2`
- Verification: `lint` pass (0 errors), `typecheck` 0 repo-wide, styles body diff identical, no dedicated screen tests exist (move is provably behavior-preserving)

### `client/app/setup.tsx` — 552 LOC (was 780), 3 any — score `63%` (`Adequate`, was 59%)

- Phase 1 DONE (2026-10-08): 227 StyleSheet lines → `client/styles/setupStyles.ts` (byte-identical, verified by diff); route path unchanged
- Remaining axes: per-step sections → components; CLOUD_OPTIONS/HEADER_TEXTS stay (route config)
- Verification: `lint` pass, `typecheck` 0 repo-wide, `setup.test.tsx` green (in 3-suite run, 34/34)

### `client/app/tasks.tsx` — 640 LOC (was 837), 5 any — score `58%` (`Adequate`, was 54%)

- Phase 1 DONE (2026-10-08): 196 StyleSheet lines → `client/styles/tasksStyles.ts` (byte-identical, verified by diff); route path unchanged
- Remaining axes: task-row → `components/`; data load/save → hook
- Verification: `lint` pass, `typecheck` 0 repo-wide, `tasksSchema` + `taskRunner` suites green (in 3-suite run, 34/34)

### `client/app/index.tsx` — 1660 LOC (was 2236), 14 any — score `54%` (`Adequate`, was 48% `Weak`)

- 10 useState, 6 effects, 16 callbacks, 7 memos, 301 style lines, 1 inner component (`SourceCard`)
- Placement: screen owns parse cache, safety tier, download/share logic → belong in `utils/` + `hooks/`
- Split axes (phased, max 2 extractions/pass): (1) pure helpers → `utils/`; (2) `SourceCard` → `components/chat/`; (3) message actions → `hooks/useMessageActions`; (4) styles → file. Touched last (highest blast radius)
- ALL 4 PHASES DONE (2026-10-08), −576 LOC total:
  - Phase 1: `utils/serverStream.ts` (`ensureThrottleTimer` + `runServerStream`), `utils/parseCache.ts` (`ParsedMessageEntry`/`PARSE_CACHE_LIMIT`/`parseCache`/`getCachedParse`), `utils/deriveSafetyTier.ts` (`SafetyTierLabel` + `deriveSafetyTier`) — verbatim moves; test pins updated (`parse-memoization.test.tsx` reads utils/parseCache, `deriveSafetyTier.test.ts` reads utils/deriveSafetyTier, `standaloneRunner.ts` doc)
  - Phase 2: `components/chat/SourceCard.tsx` (component + its 7 `source*` style keys); dead imports dropped (`Linking`, `Image`, `SearchSource`)
  - Phase 3: 5 message actions → `hooks/useMessageActions.ts` (copies/share/download-md/copy-code/info; selects `modelName`/`isLocalMode`/`localModelName` from stores inside hook); dead imports dropped (`Clipboard`, `Share`, `Sharing`)
  - Phase 4: remaining styles → `styles/indexStyles.ts` (266 lines, `Platform` dep discovered by typecheck)
  - Route path unchanged; index lint at baseline 9 warnings; tsc 0; full suite 83/83 (798 passed)
- Still >500 LOC → Modularity/Structural caps remain 1/5; further reduction needs section components (deferred)

### `client/app/settings/local-ai.tsx` — 974 LOC (was 1407), 10 any — score `52%` (`Adequate`, was 48% `Weak`)

- 15 useState, 6 effects, **0 useCallback/useMemo** (handlers recreated per render), 27 style lines (logic-dense)
- Split axes: model download/manage logic → `hooks/useModelDownload`; sections → components; memoize handlers during extraction
- Phase 1 DONE (2026-10-08): download/manage logic → `client/hooks/useModelDownload.ts` (505 LOC). Moved verbatim: 389 handler lines (load/unload RAM, download, cancel, delete, export, import, copyAndSaveImport) + downloaded/loaded state + 2 effects + resumable/cancel refs. Screen keeps `isMounted` ref (passed in), custom-model cluster, RAM-detect/recommendation. Public API: `{ downloadedModels, modelBusy, isActiveModelDownloaded, isActiveModelLoaded, handle* }`.
  - Fidelity: `diff` handlers vs HEAD = **identical (389/389 lines)**; only deltas = 2 effect deps arrays (`[isMounted]`, `[localModelName, isMounted]`) to keep lint at baseline (ref identity stable → no re-run)
  - Verification: lint 0 errors / 1 pre-existing warning (= baseline); typecheck 0 repo-wide; 6 related suites 50/50 (`customModelStorage` ×2, `localLlm`, `ramDetection`, `customModelUi`, `useConfigStore`)
  - Note: no screen-level test exists for local-ai — Phase 1 safety = verbatim diff + typecheck + suites; on-device flow check deferred (needs phone)
  - Still >500 LOC → Modularity/Structural caps remain 1/5; Phase 2 (section components + custom-model cluster → hook) needed to clear caps

### Batch 2 execution order — ALL COMPLETE (2026-10-08)

1. `browser.tsx` pilot (styles first) — DONE: `browserStyles.ts`, 639→356, score 63%
2. `setup.tsx` → `tasks.tsx` — DONE: `setupStyles.ts` 780→552 (63%), `tasksStyles.ts` 837→640 (58%)
3. `local-ai.tsx` → `index.tsx` — DONE: local-ai Phase 1 (1407→974, 52%), index Phases 1–4 (2236→1660, 54%)

## Batch 3 — components/ui giants (DONE 2026-10-08)

All four split with verbatim extractions; route/export paths unchanged; per-file lint baseline 0 problems maintained.

### `client/components/ui/CookieSyncCard.tsx` — 207 LOC (was 524) — score `64%` (`Adequate`, provisional)
- Phase A: 154 style lines → `cookieSyncCardStyles.ts` (byte-identical, `StyleSheet.hairlineWidth` covered)
- Phase B: pick/parse/import/consent logic (lines 51–214: 5 store selectors + 6 states + `lastSyncText` + 8 handlers) → `hooks/useCookieSync.ts` (216 LOC); component = props + render + 14-value destructure
- Verification: tsc 0, lint 0 problems both files; full suite 83/83

### `client/components/ui/DrawerContent.tsx` — 330 LOC (was 567) — score `57%` (`Adequate`, provisional)
- Phase A: 181 style lines → `drawerContentStyles.ts`
- Phase B: `formatDistanceToNow` → `utils/timeAgo.ts` (34 LOC, export added); thread-row JSX (map body) → `components/ui/ThreadRow.tsx` (64 LOC, props `{thread, isActive, streaming, colors, accentHex, onSelect, onOpenOptions}`; computes timeAgo internally)
- Only `_layout.tsx` imports it (default export unchanged); no direct test — covered by tsc + lint + full suite

### `client/components/ui/ThreadOptionsModal.tsx` — 333 LOC (was 489) — score `60%` (`Adequate`, provisional)
- 155 style lines → `threadOptionsStyles.ts` (`Platform.OS` dep → imported there, same lesson as indexStyles)
- Verification: ThreadOptionsModal.test.tsx 6/6, tsc 0, lint 0 problems

### `client/components/ui/settingsKit.tsx` — 338 LOC (was 472) — score `58%` (`Adequate`, provisional)
- 133 shared style lines → `settingsKitStyles.ts`; 12 exported primitives + `useAurora` re-export untouched (20+ importers unaffected)
- Verification: tsc 0, lint 0 problems; agentSettingsScreen.test in full suite

## Next Batch (deferred)

- Batch 3: components/ui giants — **COMPLETE (2026-10-08)**; all 4 now <350 LOC (CookieSyncCard <250).
- Optional deeper splits (not scheduled): local-ai Phase 2 (section components, to clear >500 caps), index.tsx section components (still 1660 >500), tasks task-row → `components/` + data-load hook.

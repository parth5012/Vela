# Wayfinder 170-171-172 — Task Progress Spec

Part of #161 — Task Progress States. Child tickets 170 (Audit), 171 (State Matrix), 172 (Dark Prototype).

---

## #170 Audit — Current Wiring

### File Paths

| Concern | File | Key Export |
|---------|------|------------|
| Screen (audit target + states owner) | `client/app/task-progress.tsx` | `TaskProgressScreen` + `LoadState='loading'|'empty'|'active'|'error'` + `SkeletonCard` |
| Store (live wiring) | `client/store/useForegroundTaskStore.ts` | `execution_id: string|null`, `currentStep: number`, `isRunning`, `isPaused`, `isCancelled`, `lastAction: string|null`, `task_plan: {task_id, steps[]}` |
| DB (persistence) | `client/db/client.ts` + `client/db/schema.ts` | `taskExecutions`, `taskStepExecutions`, `tasks` (drizzle-orm expo-sqlite), `initializeDatabase()` |
| Deeplink | `expo-router` `useLocalSearchParams<{taskId, execution_id, executionId}>` | `vela-client://task-progress` via expo-router params |
| Task runner | `client/utils/foregroundTaskRunner.ts` | `cancelForegroundTask(id)`, `resumeForegroundTask(id)` |
| Theme | `client/components/ui/settingsKit.tsx` + `client/hooks/useAurora.ts` + `client/utils/theme.ts` | `AuroraScreen`, `Card`, `PrimaryButton`, `useAurora()` → `colors.skyTop/skyBottom/glass/glassBorder`, `aurora.acc1/acc2` |

### Deeplink Params

```ts
const params = useLocalSearchParams<{ taskId?: string; execution_id?: string; executionId?: string }>();
const taskIdParam = params.taskId ?? (params as any).execution_id ?? (params as any).executionId;
const effectiveId = taskIdParam || storeExecutionId || null;
```

- Canonical: `taskId`; backward compat: `execution_id` / `executionId`; store fallback: `useForegroundTaskStore.execution_id`.
- `task-progress` uses `AuroraScreen title="Task Progress"` internal header — not `Drawer.Screen` — so casing is Title Case string prop, not filename inference (see `_layout.tsx` audit).

### Data-Flow Sketch

```
param (taskId | execution_id | storeExecutionId) -> effectiveId
  -> if !effectiveId: 350ms skeleton delay -> setLoadState('empty')
  -> else db.select(taskExecutions).where(eq(id, effectiveId)) [direct match]
       -> if miss && taskIdParam: select by task_id, sort started_at desc, pick [0] (latest run)
       -> if miss && storeExecutionId: select by storeExecutionId
       -> if miss && storeExecutionId && task_plan exists: build pseudo execution + pseudoSteps from task_plan.steps (completed/running/pending) -> active
       -> if miss && no store: empty (no id) or error ('Task execution not found')
  -> load task via eq(tasks.id, execData.task_id)
  -> load steps via eq(taskStepExecutions.execution_id, execData.id) orderBy step_index
  -> cancelled/failed map to active with badge (no separate error screen for execution status)
  -> catch -> error with message
store changes (Zustand) trigger re-render — no polling timer; loadExecution() re-runs on effectiveId/taskIdParam/storeExecutionId/currentStep/isRunning/isPaused/lastAction/task_plan change + retryKey++
```

### DB vs Store Poll Description

- DB is source of truth when `effectiveId` resolves to a persisted `taskExecutions` row; steps ordered by `step_index`.
- Store is live fallback: when DB row missing but `storeExecutionId && task_plan` exists (pre-persist or racing write), screen synthesizes execution and `pseudoSteps` from `task_plan.steps` with status derived from `currentStep`. This keeps Active rendering without spinner.
- No interval poll; Zustand subscription drives live progress (Step N/M, action, progress bar). `initializeDatabase()` guarded with `if (!db)`.

### Spinner Path Cause — Why `screenshots/13_task_progress.png` Shows Blue Spinner on Light Gray

- Legacy path: plain `<View style={{backgroundColor: '#f2f2f7'}}>` + `<ActivityIndicator color="blue">` with centered "Loading…" — no `AuroraScreen` gradient, no `THEME_COLORS`/`useAurora`, no skeleton.
- Light canvas `#F2F2F7` vs dark Aurora palette breaks shell consistency; blue spinner is default `ActivityIndicator` without `aurora.acc1`.
- Fixed in #172: replaced with `AuroraScreen title="Task Progress"` dark gradient (`skyTop`/`skyBottom` → `#0b0b1a` atmosphere) + 3× `SkeletonCard` (Card `borderColor: colors.glassBorder`, `backgroundColor: colors.glass`, skeletonLine `rgba(255,255,255,0.08/0.06)` + skeletonBar `rgba(255,255,255,0.07)` fill `0.12`) + small `ActivityIndicator color={aurora.acc1}` + `'Loading task…'` `textMuted` `sizes.sub`. No `View bg #F2F2F7` remains; `progressBg` uses `rgba(0,0,0,0.25)` border `glassBorder`, `progressFill` `bg aurora.acc1` `width: ${progressPct}%`.

---

## #171 State Matrix — Loading / Empty / Active / Error

Aligned with `screenshots/11_tasks.png` empty tone ("No active task … Create or start").

| LoadState | Condition | Copy | Visual | CTA | Notes |
|-----------|-----------|------|--------|-----|-------|
| `loading` | Initial mount; `!effectiveId` 350ms delay OR DB fetch in-flight | `Loading task…` (textMuted, sizes.sub) | 3× `SkeletonCard` (glass 0.08/0.06 + bar 0.07 fill 0.12) + `ActivityIndicator small aurora.acc1` centered | none | No `#F2F2F7`; skeleton shimmer replaces full-screen spinner |
| `empty` | `!effectiveId && !storeExecutionId` after delay; also `!execData && !storeExecutionId && !taskIdParam` | Title `No active task` (text, 600) + body `There is no task currently running. Create or start a task to track its progress here.` (textMuted, sub, lineHeight 18) | `Card gap 12` with Aurora glass | `PrimaryButton 'Go to Tasks' -> router.push('/tasks')` | Tone matches `11_tasks.png` empty state |
| `active` | `execData` found OR `storeExecutionId && task_plan` pseudo | Header `Step N/M` (aurora.acc1 22 weight 800) + sub `in progress / paused / cancelled / status` + `currentActionText` (`lastAction || execution.last_action || 'Starting…'`) lineHeight 16, 2 lines | `Card gap 10` with status badge (`Running` green `rgba(16,185,129,0.15)` #10b981, `Paused` orange #fb923c, `Cancelled` red #f87171) + progress bar `View h8 radius 999 overflow hidden bg rgba(0,0,0,0.25) border glassBorder` → fill `bg aurora.acc1 width ${progressPct}%` + `%` right-aligned + steps list `Card` title `Steps` + mapped `taskStepExecutions` ordered by `step_index` with styles `completed: bg rgba(16,185,129,0.06) number #10b981 ✓` / `running: bg rgba(59,130,246,0.08) number aurora.acc1 + spinner` / `pending: bg rgba(255,255,255,0.12)` + controls row | `Cancel` (red `rgba(239,68,68,0.9)`) when !isCancelled, `Resume` (#10b981) when isPaused, always `View Tasks` (rgba 0.08 border glassBorder) -> `/tasks` | `totalSteps = task_plan?.steps?.length || task?.steps?.length || steps.length || 1`; `currentIdx = currentStep ?? execution.current_step_index`; `progressPct = round(currentIdx/totalSteps*100)` |
| `error` / timeout | `execData` not found with ids present, or `catch` | Title `Something went wrong` (#f87171 700) + body `errorMessage || 'The task could not be loaded or timed out.'` (textMuted sub lineHeight 18) | `Card gap 12 border rgba(239,68,68,0.35)` | `PrimaryButton Retry (retryKey++)` + `Pressable 'Go to Tasks' (minHeight 48, textMuted 600) -> router.push('/tasks')` | `isCancelled`/`failed` execution status still maps to `active` (progress view with badge), not error — error is load/lookup failure only |
| `success` | Execution status `completed`/`succeeded` | — | Maps to `active` (status badge + step list) — no separate success screen per `11_tasks.png` tone; cancelled/failed also map to active for traceability | `View Tasks` | Keeps single progress shell; success is terminal active |

**Timeout note:** Parent loading timeout is modeled as `error` with the same copy/CTAs (Retry + Go to Tasks). No separate timeout state.

Validation: `npx tsc --noEmit --skipLibCheck` passes; `effectiveId` disambiguation documented (direct id preferred, task_id fallback sorted by `started_at desc`, store fallback coerced `width: ${localModelDownloadProgress ?? 0}%` style avoids `null%`).

---

## #172 Prototype Pointer — Dark Aurora Implementation

**File:** `client/app/task-progress.tsx:1` (single owner for all states)

**Tokens:**

- Screen: `AuroraScreen title="Task Progress" subtitle={loadState==='active' ? currentActionText : undefined}` with `LinearGradient [colors.skyTop, colors.skyBottom]` (dark atmosphere `#0b0b1a` family), not `View bg #F2F2F7`.
- Cards: `Card borderColor colors.glassBorder bg colors.glass` (translucent glass on dark sky).
- Text: `colors.text` (#f4f4f5 family) / `colors.textMuted` (#a9a6c8) — AA contrast on dark.
- Accent: `aurora.acc1` (derived from `accentColor` via `getAurora`) for progress fill, badge, spinner, active step number.
- Progress: `progressBg h8 borderWidth 1 radius 999 bg rgba(0,0,0,0.25) border glassBorder` → `progressFill h100 radius 999 bg aurora.acc1 width: ${progressPct}%`.
- Skeleton: `SkeletonCard gap 12 minHeight 92` with `skeletonLine h16 radius 6 bg rgba(255,255,255,0.08) w60%` / `0.06 w85% h12` + `skeletonBar h8 radius4 bg rgba(255,255,255,0.07)` fill `0.12 w45%`; loading also shows `ActivityIndicator small aurora.acc1` + `'Loading task…'` `textMuted`.

**Anti-pattern to avoid:**

- No `View style={{backgroundColor: '#F2F2F7'}}` in this file.
- No bare `<ActivityIndicator color="blue" size="large">` full-screen on light gray.
- No filename-derived casing (`task-progress` literal never used as display title).

**Deeplink params kept:** `taskId` canonical + backward compat `execution_id`/`executionId` via `(params as any)` fallback, plus `storeExecutionId` fallback for live session.

**DB fallback retained:** `task_plan` pseudo-steps when store has `task_plan` but DB row missing — ensures Active renders during race without spinner.

**Verification:** `npx tsc --noEmit --skipLibCheck` clean for client; no new deps; `graphify update .` no new node errors; visual regression checked against `screenshots/13_task_progress.png` (dark skeleton should not match light-gray canvas).

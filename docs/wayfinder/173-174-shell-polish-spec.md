# Wayfinder 173-174 — Shell Polish Spec

Part of #162 — Shell Polish. Child tickets 173 (Audit) and 174 (Polish Specs).

---

## #173 Audit — Shell Inconsistencies

### Header Casing

| Source | File | Option | Value | Evidence |
|--------|------|--------|-------|----------|
| Drawer title — Vela | `client/app/_layout.tsx:237` | `Drawer.Screen name="index" options.headerTitle` | `'VELA'` | `headerTitleStyle {fontWeight:'900', letterSpacing:3, color:'#818cf8', fontSize:16}` — brand logotype, not Title Case |
| Settings stack | `client/app/_layout.tsx:249` | `Drawer.Screen name="settings" options.headerTitle` | `'Settings'` | `600 #e4e4e7 16` — Title Case |
| Browser | `client/app/_layout.tsx:260` | `Drawer.Screen name="browser" options.headerTitle` | `'Browser'` | `600 #e4e4e7 16` |
| Tasks | `client/app/_layout.tsx:271` | `Drawer.Screen name="tasks" options.headerTitle` | `'Tasks'` | `600 #e4e4e7 16` |
| Task Progress | `client/app/task-progress.tsx:382` | `AuroraScreen title` | `'Task Progress'` | Internal Aurora header, not Drawer — Title Case both words, subtitle=`currentActionText` when active |
| About | `client/app/settings/about.tsx:41` | `AuroraScreen title` | `'About'` | Title Case single word — not `ABOUT` |
| Background — default header | `client/app/_layout.tsx:224` | `screenOptions.headerTitleStyle` | `{fontWeight:'900', color:'#818cf8'}` | Overridden per-screen above; settings stack uses 600 |

**Finding:** Casing governed by explicit `options.headerTitle` strings (formatter), never by route filename segment (`task-progress`, `local-ai`). Drift risk if new `Drawer.Screen` added without explicit `headerTitle`. Mitigated by audit comment in `_layout.tsx` above Drawer block.

**Screenshots:** `screenshots/13_task_progress.png` previously showed no shell title on light gray (legacy) — now `AuroraScreen` dark header matches shell.

### Danger Zone

| Item | File | Before | After |
|------|------|--------|-------|
| Trigger | `client/app/settings/about.tsx:15` | Single-tap Reset (destructive, no confirmation) — previous flaw | Double-confirm Modals: `firstVisible` `'Are you sure?'` + Continue, `secondVisible` `'Confirm reset'` destructive |
| First modal | `about.tsx:70` | — | `Modal transparent fade backdrop rgba(0,0,0,0.6)` `Card bg colors.card border glassBorder radius16 padding20` Title `Are you sure?` body `This will erase all local settings, threads, and cached chats. You will return to the setup screen.` buttons `[Cancel (rgba 0.06 border glassBorder) | Continue (aurora.acc1)]` minHeight 48 accessibilityRole button |
| Second modal | `about.tsx:108` | — | Same shell but `border rgba(239,68,68,0.35)` Title `#f87171 Confirm reset` body `This action cannot be undone. All local data will be permanently deleted.` + `Tap Reset to confirm.` `600` buttons `[Cancel | Reset(#ef4444)]` `onPress clearConfig+clearStore -> router.replace('/setup')` |
| A11y / AA | `about.tsx:62,78,88` | — | `accessibilityRole button`, `accessibilityLabel` on both modals, 48dp targets, AA contrast `colors.textMuted` on `colors.card` (#09090b glass) |
| Stacking risk | Android | `Alert.alert` would block thread | `Pressable Modals` with `transparent fade` + `onRequestClose` back-button dismiss on both layers |

**Screenshots:** `screenshots/10_settings_about.png` — Danger Zone position at card bottom; copy now matches spec verbatim.

### Drawer — Recent Chats & Shell

| Item | File | Current | Audit Note |
|------|------|---------|------------|
| Threads source | `client/components/ui/DrawerContent.tsx:55,139` | `useChatStore threads` → `sortedThreads` `pinned-first then updated_at desc` (`isNaN` guarded) | List is derived, not static |
| Thread rendering | `DrawerContent.tsx:242` | `Pressable` `onPress selectThread+router.navigate('/')`, `onLongPress handleOpenOptions` `delayLongPress={450}`; `threadTitle` `| pinned:'📌 ' + title`, `isActive` bg `colors.card` text `colors.text 500`, `threadTimestamp` 11px `colors.textDark`, `streaming ActivityIndicator` | No swipe gesture yet |
| Timestamp | `DrawerContent.tsx:245,29` | `formatDistanceToNow(updated_at)` → `just now / 5m ago / 3h ago / 2d ago / …w/mo/y` with `diff<0` → `''` guard | Lightweight fallback — no `date-fns` dep; kept to avoid bundle |
| Overflow | `DrawerContent.tsx:92,351` | `ThreadOptionsModal visible={optionsVisible} thread={selectedThread}` triggered by longPress | Gesture lib for swipe-to-delete explicitly out-of-scope for this slice (overflow menu only) |
| Browser top placement | `DrawerContent.tsx:171,186` | Prominent `browserRow` `minHeight 48 borderLeftWidth 3 aurora.acc1 when isBrowserActive` above `+ New Conversation` | Verified — no move per spec |
| Footer | `DrawerContent.tsx:287` | 4× `Pressable settingsButton` `Chat / Refresh Chats / Tasks / Settings` each `accessibilityRole button minHeight 48 textMuted pressed bg colors.card marginBottom 8` | 48dp AA targets; `Refresh` shows spinner when `isSyncing` |
| Section title | `DrawerContent.tsx:360` | `sectionTitle 11px 700 uppercase #71717a textDark letterSpacing 0.5` | WCAG AA: `textMuted #a9a6c8 on bg #0b0b1a >4.5:1`; `textDark` only for timestamps/section titles |
| A11y tokens | `client/utils/theme.ts` | `THEME_COLORS.deep` `text #f4f4f5`, `textMuted #a9a6c8`, `textDark #7b7899`, `glassBorder rgba(255,255,255,0.08)`, `background #0b0b1a` | Glass + muted contrast passes AA for body text; timestamp uses muted dark but is small metadata, not primary |

**Screenshots:** `screenshots/02_drawer.png` — no timestamp before this slice; longPress dots overflow menu expected.

### Local AI — Progress

| Item | File | Current |
|------|------|---------|
| Model rows | `client/app/settings/local-ai.tsx:545` | `LOCAL_MODELS.filter(status !== 'unsupported' unless showUnsupportedModels) -> .map(model -> Pressable modelRow)` |
| Status | `local-ai.tsx:553` | `getModelStatusForRam(model.name, detectedRamBytes||6GB) -> recommended #10b981 / borderline #fb923c / unsupported #ef4444` pill border `statusColor` |
| Download state | `local-ai.tsx:48,162` | `localModelDownloadProgress: number|null` from `useConfigStore`; `isDownloading = !==null`; `isActiveDownloading = isSelected && progress!==null` |
| Inline progress | `local-ai.tsx:601` | `isActiveDownloading ? View marginTop 10 gap4 -> View h8 radius4 overflowHidden bg rgba(255,255,255,0.08) borderWidth1 borderColor glassBorder -> inner View h100 width ${progress ?? 0}% bg aurora.acc1 radius4 + Text 'Downloading {name} {progress}%' textMuted sub-1 600 + right Text '{progress}%' aurora.acc1 700` ; no native `ProgressBar` |
| Row a11y / sizing | `local-ai.tsx:562,569` | `accessibilityLabel 'Downloading {model} {progress}%' when active else '{name} {status}, Downloaded/Not downloaded'` `accessibilityState selected/disabled` ; row `modelRow borderRadius10 borderWidth1 bg rgba(0,0,0,0.25) minHeight48` ; non-active rows `opacity 0.6 while downloading` |
| Global fallback | `local-ai.tsx:746` | `isDownloading ? Card 'Downloading {localModelName} — {progress}%' + progressBg border glassBorder bg rgba(0,0,0,0.25) -> fill width ${progress ?? 0}% bg aurora.acc1` |
| File callback | `local-ai.tsx:240` | `FileSystem.createDownloadResumable(..., (downloadProgress) => setLocalModelDownloadProgress(Math.round(written/expected*100)))` — `??0` guard avoids `null%` style |
| Contrast | `local-ai.tsx:584` | Status pill `border statusColor` + `bg rgba(0,0,0,0.3)` ensures AA on glass; progress bar AA via `aurora.acc1` on `rgba(255,255,255,0.08)` |

**Screenshots:** `screenshots/08_settings_local_ai.png` — progress under filename now matches inline spec; no native bar.

### A11y Tokens

| Token | Value | Usage | Contrast |
|-------|-------|-------|----------|
| `THEME_COLORS.deep.text` | `#f4f4f5` | Primary text | AA on `background #09090b / #0b0b1a` |
| `textMuted` | `#a9a6c8` | Body muted, card text, footer items | >4.5:1 on `background #0b0b1a` |
| `textDark` | `#7b7899` | Timestamps, section titles, URL metadata | Passes for large/metadata only; not body |
| `glassBorder` | `rgba(255,255,255,0.08)` | Card borders, inputs | Visual separator, not text |
| `aurora.acc1` | accent-derived | Progress fill, active borderLeft, spinner | AA when used as fill on dark |

**Screenshots:** `05_settings_appearance.png` / `08` / `10` — all dark glass shells, no light canvas.

---

## #174 Polish Specs — One-Line Shippable Specs

Each spec is independently shippable; no browser/chat coupling; only files listed are touched.

### (1) Title Casing Rule — Formatter Over Route Segment

> Display titles are explicit `options.headerTitle` Title Case strings (`600` except `VELA` logotype `900 letterSpacing 3 #818cf8`), never derived from filename segment; `task-progress` screen uses `AuroraScreen title="Task Progress"` internal header (both words capitalized, weight `600` via `useAurora`).

**Files:** `_layout.tsx` (Drawer.Screen `headerTitle` + audit comment), `task-progress.tsx` (`AuroraScreen title="Task Progress"`), `settings/about.tsx` (`AuroraScreen title="About"`), `settingsKit.tsx` (`headerTitle fontWeight 600`).

### (2) Danger Zone — Double-Confirm Copy & CTAs

> First modal body `This will erase all local settings, threads, and cached chats. You will return to the setup screen.` buttons `[Cancel | Continue(aurora.acc1)]`; second modal `border rgba(239,68,68,0.35) title #f87171 Confirm reset` body `This action cannot be undone. All local data will be permanently deleted. Tap Reset to confirm.` buttons `[Cancel | Reset(#ef4444)]`; both `Modal transparent fade backdrop rgba(0,0,0,0.6) radius16 borderWidth1 padding20 maxWidth420 48dp minHeight accessibilityRole button` → `clearConfig+clearStore -> router.replace('/setup')`.

**File:** `settings/about.tsx:70,108` Modals as spec.

### (3) Drawer — Timestamp + Overflow + 48dp + AA

> Timestamp `formatDistanceToNow` (`just now`, `5m ago`, `3h ago`, `2d ago`, `5w ago`…) as `threadTimestamp 11px colors.textDark` under title with `diff<0`/`isNaN` guard → `''`; overflow via `onLongPress 450ms → ThreadOptionsModal` (no swipe — gesture lib out-of-scope); `threadItem flex row space-between 10/12 padding 6 radius` active `bg colors.card text 500` muted `textMuted` pinned `600`; footer 4 items `Chat/Refresh/Tasks/Settings` each `Pressable accessibilityRole button minHeight 48 textMuted pressed bg colors.card`; `sectionTitle 11px 700 uppercase textDark`; WCAG AA `textMuted #a9a6c8 on bg #0b0b1a >4.5:1` via `THEME_COLORS`/`AuroraScreen` tokens.

**File:** `components/ui/DrawerContent.tsx:29,242,287`.

### (4) Local AI — Inline Progress + % + a11y

> Per-row when `isActiveDownloading`: `View h8 radius4 overflowHidden bg rgba(255,255,255,0.08) borderWidth1 borderColor glassBorder -> View width ${progress ?? 0}% bg aurora.acc1 radius4` surmounted by `Text 'Downloading {name} {progress}%' textMuted sub-1 600` and right-aligned `Text '{progress}%' aurora.acc1 700`; row `Pressable minHeight 48 accessibilityLabel 'Downloading {model} {progress}%'` else `'{name} {status}, Downloaded/Not downloaded'` / `accessibilityState selected/disabled opacity 0.6 for non-active while downloading`; keep native `FileSystem.createDownloadResumable` callback; also global `Card` fallback when `isDownloading`.

**File:** `app/settings/local-ai.tsx:562,601,746`.

### (5) Accent Swatches — 32dp + AA Contrast

> Swatches are `32dp` circles (`width 32 height 32 radius 16 borderWidth 1 transparent`), selected ring `2px aurora.acc1` (`borderColor aurora.acc1 borderWidth 2`) with `✓` on accent (`#0b0b1a 13 700`), default `background ACCENT_COLORS[color]`; row gap `14`, `accessibilityRole button` / `accessibilityLabel 'Accent {color}'` / `accessibilityState selected`; contrast AA on glass `bg colors.glass` / `glassBorder`; header weight `600` (not 700/900) via `AuroraScreen headerTitle fontWeight 600` matching `_layout` spec; `DangerButton minHeight 48 pressed rgba(239,68,68,0.18)` + `PrimaryButton minHeight 48`.

**File:** `components/ui/settingsKit.tsx:261,400` (`AccentDots` + `styles.accentDot` + `primary minHeight 48` + `headerTitle 600`).

---

## Dependency & Independence Note

- Shell and task-progress maps remain independent: no browser empty-state or tool-call JSON changes in this slice; only files listed touch shell polish.
- No new deps: `formatDistanceToNow` stays (no `date-fns`); swipe gesture lib deferred; native `ProgressBar` not used.
- `npx tsc --noEmit --skipLibCheck` clean; `npm test` unaffected; `graphify update .` no new node errors.

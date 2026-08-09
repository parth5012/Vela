# Vela Client

Android AI assistant chat app. Single Expo project in `client/`. No monorepo.

## Structure

- `client/` — the entire Expo app (all code lives here)
- `docs/` — supplementary docs (gitignored)
- `client/graphify-out/` — knowledge graph of the codebase; query before reading files blindly

## Commands (run from `client/`)

```
npm start            # Expo dev server
npm test             # Jest (jest-expo preset)
npm run android      # expo run:android
npx tsc --noEmit     # typecheck (no script alias — run manually)
npx expo prebuild --clean  # regenerate native dirs
```

No lint or format scripts are configured.

## Physical device policy

The Android device connected over ADB is the user's personal phone, not a
disposable emulator. Ask for approval BEFORE any of the following, and wait for
an explicit yes:

- Installing any package other than the app itself — especially instrumentation
  / `androidTest` APKs (`com.parth5012.client.dev.test`), which `connectedAndroidTest`
  installs as a separate companion app
- Uninstalling or clearing data for any package
- Deleting files from device storage (e.g. downloaded models under `files/models/`)

Reading state is fine without asking: `adb devices`, `logcat`, `pm list packages`,
`run-as ... ls`, pulling files for inspection.

When on-device verification is needed, propose the plan and what it will install,
then let the user decide. Prefer having the user drive the UI over installing
extra tooling. MIUI blocks `adb shell input` (SecurityException: INJECT_EVENTS),
so UI automation is not an option on this device anyway.

## See also

- `client/AGENTS.md` for app-specific guidance
- `client/build guide.txt` for signing AAB → APK with bundletool

## Knowledge graph

`graphify-out/` contains a pre-built knowledge graph. Query it before reading files blindly:
- God nodes: `useConfigStore` (11 edges), `useChatStore` (7 edges)
- 4 screens, 8 communities, 117 nodes
- use the `graphify` cli to query the graph 
- Dont use Glob or grep to read files

## Agent skills

### Issue tracker

Issues and specs are tracked locally as Markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage states use standard role strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repository layout using `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.


# Vela × Shizuku Integration

_Status: implemented, host-verified incl. Gradle compile; on-device pairing/permission flow still to run (see §9)._
_Primary research: [docs/research/shizuku.md](research/shizuku.md) (64 sources)._

## 1. What and why

Shizuku lets an ordinary app run code as **shell (uid 2000)** or **root (uid 0)**
through a server process started via ADB/wireless debugging or root — no root
required on Vela's side. Vela uses it to give the Device Agent a narrow set of
**privileged system operations** that AccessibilityService cannot perform:
granting permissions, writing settings, force-stopping, enabling/disabling,
clearing data, installing/uninstalling packages.

**Scope decision (agreed, 2026-10-01): allowlisted operations only.** No raw
shell string ever reaches the native layer. The complete privileged surface is
the eight tools in §3.

## 2. Architecture

```
Owner asks agent ──► backend tool (tools/device_agent.py)
                        │  wait_for_client_event(action=…)
                        ▼
     assistant message carries <call:device_* input="…">
                        ▼
     client app/index.tsx device executor effect
                        │  isShizukuTool()?  ── no ──► Accessibility gate (#158)
                        ▼ yes
     evaluateSafety (safetyManager.ts)  … policy tier gate (auto/ask/deny)
                        ▼
     executeDeviceAction → executeShizukuOp (deviceActionExecutor.ts)
                        │  buildShizukuOp()     — TS allowlist + arg validation
                        │  getShizukuStatus()   — readiness gate (§4)
                        ▼
     DeviceAgentModule.kt  runPrivilegedOp(op, args)
                        │  bindUserService (Shizuku UserService, per call)
                        ▼
     ShizukuOpsService.kt  execOp()             — Kotlin allowlist (trust boundary)
                        │  ProcessBuilder("/system/bin/pm|am|settings", …)
                        ▼      runs as shell uid 2000 (or root uid 0)
     "exit=<code>\n<output>" back up the same path
```

Two **orthogonal gates** guard every privileged call:

1. **Readiness gate** (executor): Shizuku installed/running/granted? If not →
   outcome `unavailable`, nothing dispatched, message points at
   Settings → Shizuku Setup.
2. **Policy gate** (safetyManager): the Owner's tier for the tool
   (auto / ask / deny). Defaults: `root_shizuku` **deny**, `sideloads` deny,
   `permission_toggles` deny, `settings_changes` auto, `deletions` deny —
   i.e. nothing privileged runs until the Owner opts in on the
   Device Agent Permissions screen.

## 3. The eight allowlisted operations

| Backend tool | Native op | Executed (as shell) | Safety tier |
|---|---|---|---|
| `device_app_permission_grant(pkg, perm)` | `pm_grant` | `pm grant <pkg> <perm>` | `permission_toggles` |
| `device_app_permission_revoke(pkg, perm)` | `pm_revoke` | `pm revoke <pkg> <perm>` | `permission_toggles` |
| `device_setting_put(ns, key, value)` | `settings_put` | `settings put <ns> <key> <value>` (ns ∈ system\|secure\|global) | `settings_changes` |
| `device_app_force_stop(pkg)` | `force_stop` | `am force-stop <pkg>` | `root_shizuku` |
| `device_app_set_state(pkg, enabled\|disabled)` | `set_enabled` | `pm enable\|disable <pkg>` | `root_shizuku` |
| `device_app_clear_data(pkg)` | `clear_data` | `pm clear <pkg>` | `deletions` |
| `device_app_install(apk_path)` | `install` | `pm install -r <apk>` (absolute `.apk` path) | `sideloads` |
| `device_app_uninstall(pkg)` | `uninstall` | `pm uninstall <pkg>` | `sideloads` |

Wiring: `backend/tools/device_agent.py` → exported in `backend/tools/__init__.py`
→ bound to the `device_agent` agent in `backend/agent/registry.py`. Tool names
match the chat device-call regex `device_[a-z_]+` automatically.

Contract quirks worth knowing:
- `device_setting_put` targets the client as `"<namespace>/<key>"` (single
  target string; value carries the new value).
- `buildShizukuOp()` (client/utils/shizuku.ts) and `ShizukuOpsService.buildCommand()`
  both validate — TS fail-closes **before** dispatch, Kotlin re-validates at the
  trust boundary (defense in depth; a version-skewed client still can't smuggle
  an arbitrary command).

## 4. Status model & UI

`getShizukuStatus()` returns `{ installed, serverRunning, permissionGranted, uid }`;
`deriveShizukuState()` folds it into one state:

| State | Meaning | Guide screen action |
|---|---|---|
| `ready` | server alive + permission granted | Recheck button; shows uid (0 = root, 2000 = ADB) |
| `permission_denied` | server alive, Vela not granted | **Request permission** → `Shizuku.requestPermission()` dialog |
| `server_stopped` | manager installed, server down | Recheck; steps point at Shizuku → Start (wireless debugging pairing) |
| `app_missing` | no manager and no live server | **Install Shizuku** (Play Store / shizuku.rikka.app) |
| `unknown` | native module absent (web/dev build) | Explains the Android build is required |

A live server is authoritative even when `installed=false` — that is the
**Sui/root** shape (no manager app). Sui also auto-initialises through
`ShizukuProvider`.

**Guide screen:** `client/app/settings/shizuku.tsx`, reached from
Settings → Permissions → *Shizuku Setup* and from a link card atop
Device Agent Permissions. It shows live status, the 5-step pairing guide,
the reboot caveat, and the capability list with policy tiers.

## 5. Native build details

- Deps (`client/modules/device-agent/android/build.gradle`):
  `dev.rikka.shizuku:api:13.1.5` + `dev.rikka.shizuku:provider:13.1.5`
  (Maven Central), plus `coreLibraryDesugaring` — required by API 13.1.x at
  minSdk 24.
- `buildFeatures.aidl true` compiles `IShizukuOps.aidl`, which pins
  `destroy() = 16777114` (Shizuku server's destroy transaction — see
  Shizuku-API README) and `execOp(String, in String[]) = 2`.
- `src/main/AndroidManifest.xml` declares `rikka.shizuku.ShizukuProvider`
  (`${applicationId}.shizuku`, resolves per dev/prod variant) and a
  `<queries>` entry for `moe.shizuku.privileged.api` — the manager's
  `applicationId` (not its Gradle namespace `moe.shizuku.manager`) — for
  status detection on Android 11+.
- `consumer-rules.pro` keeps `ShizukuOpsService` + `IShizukuOps`: the Shizuku
  server instantiates the service **by name via reflection**, which R8 would
  otherwise rename.
- `ShizukuOpsService` runs in the user-service process (shell/root uid),
  is non-daemon (dies with the app process), tag `vela-shizuku-ops`,
  version `1` (bump to force-restart after code changes).
- Commands run via `ProcessBuilder` with **absolute paths and argument arrays —
  no shell**, output capped at 128 KiB, 15 s timeout.

## 6. Result & outcome contract

Native always returns `"exit=<code>\n<output>"`:

| exit | Meaning | Executor outcome |
|---|---|---|
| 0 | success | `executed` (observation = output) |
| 124 | command **started** but timed out | `indeterminate` — may have partially run; verify before retry |
| 125 | not ready / bind failed (nothing ran) | `failed` |
| 126 | op/args rejected by Kotlin allowlist (nothing ran) | `failed` with service reason |
| 127 | binary failed to start (nothing ran) | `failed` with service reason |
| ≠0 | command ran, non-zero exit | `failed` with output |
| *(throw from `execOp`)* | binder died mid-call | `indeterminate` — may have run; verify before retry |

Pre-dispatch problems are deliberately **plain results, never exceptions**, so
they can never be misreported as `indeterminate` (which would invite a blind
retry on the Owner's phone). A timeout is the one failure that *is* reported
as `indeterminate`: the process was started, so state may already have changed.
(CodeRabbit review on PR #332 caught 124 initially mapping to `failed`, and
the 126/127/124 strings missing their `exit=` prefix.)

## 7. What shell uid can and cannot do

Can: `pm grant/revoke` (runtime permissions), `settings put`, `am force-stop`,
`pm enable/disable/clear/install/uninstall`, read `dumpsys`, etc.
Cannot: read another app's private data (`/data/user/0/<pkg>` — shell has no
access), bypass SELinux, or inject input where the OEM blocks `INJECT_EVENTS`.

## 8. Known limitations

- **Reboot**: without root, the Shizuku server dies on every reboot; the Owner
  re-pairs/restarts (Android 11+ wireless debugging, no PC). Guide screen says so.
- **MIUI**: the connected test phone blocks `adb shell input`
  (SecurityException: INJECT_EVENTS — see `client/AGENTS.md`); shell-uid input
  injection may hit the same wall. The allowlisted ops above are *not* input
  injection and are unaffected.
- **Play Store**: this integration runs in the sideloaded dev build
  (`com.parth5012.client.dev`). A store listing would need the capability list
  disclosed; nothing here is a hidden shell.
- **Policy defaults deny** most privileged tiers — enabling them is an explicit
  Owner action on Device Agent Permissions.

## 9. Verification

| Check | Command | Result |
|---|---|---|
| Client shizuku suites (28 tests) | `cd client && npx jest shizuku` | 3 suites / 28 pass |
| Client full suite | `cd client && npx jest --silent` | 66 suites / 622 pass / 1 skipped |
| Typecheck | `cd client && npx tsc --noEmit` | only pre-existing TS2688 (`node` types) |
| Lint (changed files) | `cd client && npx eslint <files>` | 0 errors (9 pre-existing warnings in index.tsx) |
| Backend suite (incl. `test_tools_shizuku.py`) | `cd backend && uv run pytest -q` | 328 passed |
| Native compile | `cd client/android && ./gradlew :device-agent:assembleDebug` | **BUILD SUCCESSFUL** — AIDL (`= 16777114` accepted), Kotlin, desugaring, Shizuku 13.1.5; `device-agent-debug.aar` contains `ShizukuOpsService` + `IShizukuOps$Stub` |
| App manifest merge | `./gradlew :app:processDebugMainManifest` | **BUILD SUCCESSFUL** — `ShizukuProvider` authority resolved to `com.parth5012.client.dev.shizuku`, `<queries>` merged |
| On-device (pair → grant → run an op) | manual via guide screen | **NOT YET RUN — needs Owner's phone** |

## 10. File map

- Research: `docs/research/shizuku.md`
- Backend: `backend/tools/device_agent.py`, `backend/tools/__init__.py`, `backend/agent/registry.py`, `backend/tests/test_tools_shizuku.py`
- Client logic: `client/utils/shizuku.ts`, `client/utils/safetyManager.ts`, `client/utils/deviceActionExecutor.ts`, `client/app/index.tsx`
- Native: `client/modules/device-agent/android/{build.gradle, consumer-rules.pro, src/main/AndroidManifest.xml, src/main/aidl/.../IShizukuOps.aidl, src/main/java/.../ShizukuOpsService.kt, DeviceAgentModule.kt}`
- UI: `client/app/settings/shizuku.tsx`, `client/app/settings/index.tsx`, `client/app/settings/device-agent.tsx`
- Tests: `client/__tests__/shizukuSafety.test.ts`, `client/utils/__tests__/shizuku.test.ts`, `client/utils/__tests__/deviceActionExecutor.shizuku.test.ts`

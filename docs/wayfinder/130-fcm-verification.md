# Wayfinder 130 — FCM Verification (end-to-end)

Map: [#130 FCM Setup (Server-Side Push)](https://github.com/parth5012/Vela/issues/130) · Ticket: [#137 Verify — end-to-end FCM delivery on device](https://github.com/parth5012/Vela/issues/137)

Manual verification runbook for the FCM pipeline built in #134 / #135 / #136.
No physical-device install is performed by automation; an operator with a dev-client build runs the steps below per `client/AGENTS.md` (read-only inspection without approval is fine; do not install instrumentation APKs without explicit yes).

---

## 1. Prerequisites

### 1.1 Firebase project and credentials

| Artifact | Location | Tracked? | Purpose |
|---|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | `backend/.env` (and `render.yaml` env `sync:false`) | **No** — secret | `firebase-admin` FCM HTTP v1 send (`backend/tools/notify.py:_ensure_firebase_initialized`) |
| `client/google-services.json` | `client/google-services.json` | **No** — gitignored (root `.gitignore`) | Native FCM config baked into Android dev-client build |

Provision per #131:

1. Firebase Console → Project Settings → Service accounts → Generate new private key.
2. Copy the entire JSON file content as a **single-line** env var value for `FCM_SERVICE_ACCOUNT_JSON`.
   - Template in `backend/.env.example:89` and `render.yaml:49` (`sync:false`).
   - Never commit the raw JSON; `backend/.env` is gitignored.
3. Ensure `client/google-services.json` is present locally (downloaded from Firebase Console → Project Settings → Your apps → google-services.json). Do not commit.
4. Verify `project_id` in both artifacts matches (mismatch → `SENDER_ID_MISMATCH` / silent drop).

### 1.2 Backend env

```env
# backend/.env (required for verification script)
DATABASE_URL=postgresql://...        # must reach the same DB the device POSTs to
FCM_SERVICE_ACCOUNT_JSON={"type":"service_account", ... }  # single-line JSON
```

`uv sync --frozen` installs `firebase-admin>=6.5.0` (see `backend/pyproject.toml:34`). No extra deps.

### 1.3 Client build — dev-client required

> **Expo Go cannot test native FCM** — `expo-notifications` FCM requires native code.

Two equivalent paths (pick one):

**A) Local prebuild + run (fastest on Windows — needs Android SDK/NDK):**
```bash
cd client
npx expo prebuild --clean          # regenerates android/ from app.config.js
npm run android                    # expo run:android → installs com.parth5012.client.dev
# If deep path issues on Windows, use: powershell -ExecutionPolicy Bypass -File scripts/build-release-shortpath.ps1
```

**B) EAS development build (no local NDK):**
```bash
cd client
eas build --profile development --platform android   # per eas.json:development (developmentClient:true, internal)
# Install resulting APK/AAB on device
```

`app.config.js` already wires `expo-notifications` plugin and `android.googleServicesFile: ./google-services.json`, so the built APK contains FCM. `eas.json:development` sets `APP_VARIANT=development` → package `com.parth5012.client.dev` (distinct from prod).

---

## 2. Verification steps

### Step 1 — Build and install dev-client

1. Ensure `client/google-services.json` exists (not tracked) and `FCM_SERVICE_ACCOUNT_JSON` matches its `project_id`/`project_number`.
2. Build per §1.3 A or B and install on device.
3. Launch app → complete onboarding/setup. This triggers the registration hook:

   - `client/app/_layout.tsx` effect on `hasHydrated && isConfigured` calls `registerAndPostToken()` (`client/utils/pushRegistration.ts`).
   - Creates 4 Android channels (`vela_task_completion` HIGH, others DEFAULT).
   - Requests notification permission; on grant calls `Notifications.getDevicePushTokenAsync()` and `POST /api/config/device-token` via `useConfigStore.getState().apiUrl/apiKey`.

### Step 2 — Confirm token registered in backend

**Via DB (authoritative):**
```sql
SELECT key, value, updated_at FROM system_settings WHERE key='fcm_device_token';
-- value is the FCM registration token; updated_at should be recent
```

**Via backend logs:** look for `Successfully registered/updated FCM device token` (token_prefix logged, not full token) from `agent/main.py:318`.

**Via device logs:**
```bash
adb logcat | findstr "pushRegistration"
# expect: [pushRegistration] Token registered with backend
# and:    [FCM Token]: <token>
```

If no token: check permission granted in system settings, and `apiUrl`/`apiKey` configured (setup screen).

### Step 3 — Send a test push from the backend

No debug HTTP endpoint exists; use the one-off script (reads token from DB and calls `send_push`).

**From `backend/` directory:**
```bash
uv run python scripts/test_fcm_push.py
# Options:
uv run python scripts/test_fcm_push.py --title "Vela Test" --body "Hello from backend" --type task_completion --conversation-id test-123
uv run python scripts/test_fcm_push.py --dry-run          # print without sending
uv run python scripts/test_fcm_push.py --token <explicit>  # bypass DB lookup
```

The script prints masked token prefix, `FCM creds present: project_id=...`, payload, and `[ok]`/`[fail]`. On failure it hints at UNREGISTERED / creds / project mismatch.

**Alternative without script (curl → then script):**

Register/re-register token manually (e.g. from `adb logcat` FCM token), then reuse script:

```bash
curl -X POST "$BACKEND_URL/api/config/device-token" \
  -H "Authorization: Bearer $VELA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"<FCM_TOKEN>\"}"

# then
uv run python scripts/test_fcm_push.py --type briefing --conversation-id <real-conversation-uuid>
```

`$BACKEND_URL` is `https://vela-ivnn.onrender.com` in prod (`render.yaml:42`) or `http://localhost:8000` locally. `VELA_API_KEY` is `backend/.env`.

### Step 4 — Verify delivery in all three app states

Use a **real** `conversation_id` (create a chat first; copy its `id` from the app or DB) to test deep-linking; `test-123` exercises delivery but will not resolve to a thread.

| App state | How to set it | Expected notification UX | Tap expectation (routing per #133 `client/utils/notificationRouting.ts`) |
|---|---|---|---|
| **Foreground** | App open and visible | Banner via `Notifications.setNotificationHandler` (`shouldShowAlert/sound/banner:true` in `_layout.tsx`). Log: `[notifications] foreground received` with data. Tap optional. | App already open — banner tap (or background after navigating away) should `routeByType`: all known types (`task_completion`, `calendar_reminder`, `briefing`, `checkin`) and unknown/generic → `selectThread(conversation_id)` if present, then `router.replace('/')` (chat home). |
| **Background** | Press home / switch apps (do not kill) | Tray notification in notification shade (`vela_*` channel; `task_completion` HIGH → heads-up). Log not visible until tap. | Tap → `addNotificationResponseReceivedListener` fires → `routeByType` → lands on `/` with thread selected. Verify correct thread opens. |
| **Killed** | Swipe away from recents / Force stop | Tray notification same as background. | Tap → cold start → `getLastNotificationResponseAsync()` in `_layout.tsx` fires after `hasHydrated && isRouterReady` → `routeByType` → same landing as above. This is the critical cold-start path. |

**Routing table (single source of truth: `client/utils/notificationRouting.ts:routeByType`):**

All cases currently land on `/` (chat home); deep-link `vela-client://conversation/{id}` is canonical (+ `chat/{id}` alias) per `parseNotificationData`/`buildDeepLink`. Future extensibility notes in that file for `briefing → /briefing-history` and `checkin → /journal`.

Check logs for per-type routing:

```bash
adb logcat | findstr "notifications"
# expect: [notifications] routing <type> -> conversation/<id>
```

**How to check each:**

1. Foreground: keep app open, run `uv run python scripts/test_fcm_push.py --type task_completion --conversation-id <real-id>` → banner appears within seconds.
2. Background: home the app, send again with different `type` (e.g. `briefing`) → tray appears; tap → verify lands on `/` with thread.
3. Killed: kill app fully, send again (e.g. `checkin`) → tray appears; tap → app launches and routes to `/` with thread.

Repeat with `generic` (omit/invalid `type`) to verify fallback still routes to `/`.

### Step 5 — Optional follow-up checks

- Try each `type`: `task_completion`, `calendar_reminder`, `briefing`, `checkin`, and omitted type (`generic`).
- Verify channel mapping in tray long-press → channel name matches `vela_task_completion` / `vela_calendar_reminders` / etc. (`pushRegistration.ts:ensureAndroidChannels`).
- Confirm token refresh: `adb logcat | findstr "pushRegistration.*refresh"` — `addPushTokenListener` re-POSTs on rotation (no reinstall needed).

---

## 3. Expected results and acceptance

- `system_settings.fcm_device_token` present after setup.
- `uv run python scripts/test_fcm_push.py` exits `0` and `[ok]` when credentials + token present.
- Notification visible in all three states; tap deep-links per routing table (for known types and generic fallback).
- No crashes; foreground banner does not duplicate tray when handled by `setNotificationHandler`.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Script: `No FCM device token found` | Setup not completed or permission denied; token never POSTed | Complete setup on dev-client, grant notifications, check `apiUrl`/`apiKey` in setup; `adb logcat | findstr pushRegistration`; re-run setup |
| Script: `FCM_SERVICE_ACCOUNT_JSON not set` / malformed | Env var missing or not valid JSON (must be single-line JSON) | Set in `backend/.env` from `backend/.env.example:89`; on Render set via dashboard (sync:false); validate `python -c "import json,os; json.loads(os.environ['FCM_SERVICE_ACCOUNT_JSON'])"` |
| Script: `[fail] FCM push not sent` + backend log `UNREGISTERED` | Token stale (app uninstalled, cleared data, or project mismatch) | Backend auto-deletes token (`tools/notify.py:_delete_token` on `UNREGISTERED`/`registration-token-not-registered`). Re-register: reopen app (setup hook) or `curl POST /api/config/device-token` with fresh token from `adb logcat` |
| No notification on device but script `[ok]` | `google-services.json` project mismatch vs service account `project_id`; or device notifications disabled | Compare `project_id` in `client/google-services.json:project_info.project_id` vs `FCM_SERVICE_ACCOUNT_JSON.project_id`; check system notification permission for Vela (Dev) |
| Killed tap goes to `/` but wrong thread | `conversation_id` not a valid `conversations.id` | Use a real `id` from the same `DATABASE_URL` DB; `test-123` demo id will route to `/` without selecting thread (expected) |
| `SENDER_ID_MISMATCH` in backend logs | Service account from different Firebase project than `google-services.json` | Re-provision both from same Firebase project per §1.1 |
| Channels missing / wrong importance | `ensureAndroidChannels` not run (only on `registerAndPostToken`) | Reinstall dev-client or trigger setup again; channels created at registration time |

Logs of interest:

```bash
# Backend (local)
uv run uvicorn agent.main:app --reload   # look for: Firebase admin initialized, FCM push sent, UNREGISTERED cleanup, FCM send failed

# Device
adb logcat | findstr "notifications pushRegistration FCM"
```

---

## 5. Future re-verification checklist (copy for any map touching FCM)

- [ ] `FCM_SERVICE_ACCOUNT_JSON` still set (backend boots without it but sends skip+log).
- [ ] `client/google-services.json` present locally and gitignored; `project_id` matches service account.
- [ ] Dev-client builds (no regression in `app.config.js` `expo-notifications` plugin / `android.googleServicesFile`).
- [ ] Setup still triggers `registerAndPostToken` + token POST (check `system_settings`).
- [ ] `uv run python scripts/test_fcm_push.py` → `[ok]` (all 5 type variants).
- [ ] Foreground banner, background tray tap, killed cold-start tap all deliver and route per `routeByType`.
- [ ] `UNREGISTERED` cleanup still deletes stale token (see `tools/notify.py:_is_unregistered_error` tests).
- [ ] No FCM credentials committed (`git status` clean of `.env`, `google-services.json`, inline JSON).

---

## 6. References

- Backend helper: `backend/tools/notify.py` — `send_push` / `send_push_async`, channel map, UNREGISTERED handling (17 tests in `backend/tests/test_notify.py`).
- Endpoint: `backend/agent/main.py:POST /api/config/device-token` → `system_settings.fcm_device_token`.
- Env docs: `backend/.env.example:89` (`FCM_SERVICE_ACCOUNT_JSON`), `render.yaml:49`.
- Client registration: `client/utils/pushRegistration.ts` + wiring in `client/app/_layout.tsx` (commit 2fe1c68, #135).
- Client listeners + routing: `client/utils/notificationRouting.ts` (routing table, `parseNotificationData`, `buildDeepLink`, `routeByType`) + trio listeners in `client/app/_layout.tsx` (`setNotificationHandler`, `addNotificationReceivedListener`, `addNotificationResponseReceivedListener`, `getLastNotificationResponseAsync`) — commit 529d82a, #136.
- Design docs: #131 (credentials contract), #132 (registration lifecycle), #133 (routing table / deep-link).

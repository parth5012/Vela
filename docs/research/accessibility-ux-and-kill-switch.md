# Research: Android Accessibility Service UX, Confirmation Gates & Kill Switch Architecture

**Map Reference:** #608 — Device Agent UI Polish  
**Ticket Reference:** #610 — `[HITL] Research: Accessibility service UX on Android`  
**Date:** 2026-11-24  
**Status:** Completed  

---

## 1. Executive Summary

Autonomous on-device agents require robust safety mechanisms, clear user consent flows, and instant interruptibility to maintain user trust. On Android, autonomous device interaction relies primarily on the Android Accessibility Service framework (`AccessibilityService`) to inspect screen hierarchy nodes and inject gesture/action dispatches. Because Accessibility permissions grant full control over the device's UI, the operating system enforces strict permission boundaries, and application UX must bridge these technical and security realities.

This document synthesizes research and concrete architecture patterns for:
1. **Accessibility Permission Flow UX**: Seamless 3-step onboarding that handles system settings transitions and Android 13/14+ restricted settings.
2. **Action Confirmation Dialogs**: Risk-tiered execution interceptors that present contextual payload inspectors before executing destructive or high-risk actions.
3. **Read-Only Screen Mirror (Simplified DOM)**: Lightweight, non-interactive visual hierarchy tree rendering with sensitive field masking.
4. **Session-Only Action History**: Ephemeral, in-memory action event tracking that avoids persistent database storage of sensitive screen interactions.
5. **Dual-Trigger Kill Switch**: Active-only floating stop overlay button combined with hardware volume key interception for zero-latency execution aborts.

---

## 2. Android Accessibility Service UX & Permission Model

### 2.1 OS Constraints & Permission Boundaries
- **No Direct Runtime Dialog:** Unlike standard Android runtime permissions (e.g., `RECORD_AUDIO`, `CAMERA`) which can be granted via an in-app system prompt (`ActivityCompat.requestPermissions`), Android strictly forbids apps from granting Accessibility Service permissions programmatically or via direct popups.
- **System Settings Redirection:** The application must deep-link the user directly to system settings:
  ```kotlin
  val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
  intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
  context.startActivity(intent)
  ```
- **Android 13/14+ "Restricted Settings" Gate:**
  For sideloaded applications (non-Play Store installs), Android 13+ blocks accessibility activation with a "Restricted setting" dialog ("For your security, this setting is currently unavailable").
  - To resolve this, users must:
    1. Open App Info (`Settings.ACTION_APPLICATION_DETAILS_SETTINGS`).
    2. Tap the top-right three dots menu.
    3. Select "Allow restricted settings" and authenticate with biometrics/PIN.
    4. Return to Accessibility Settings to toggle the service.
  - The onboarding UI must explicitly provide guidance for this scenario if restricted settings are detected.

### 2.2 3-Step Guided Onboarding Flow
To maximize completion rate and minimize drop-off:
1. **In-App Explainer Screen:**
   - Displays clear rationale: why the agent requires Accessibility (to see button coordinates and navigate).
   - Prominent privacy guarantee: **All screen processing runs strictly on-device; screen text and coordinates are never transmitted to external servers.**
2. **Direct Intent Launch with Overlay Guidance:**
   - User taps "Open Accessibility Settings".
   - Application launches `Settings.ACTION_ACCESSIBILITY_SETTINGS` while displaying a brief toast/floating hint: *"Tap 'Vela' under Installed Apps and turn it ON"*.
3. **Automatic Foreground Detection (`AppState`):**
   - When the user returns to Vela, the React Native application listens for `AppState.addEventListener('change', ...)` transitioning to `'active'`.
   - On resume, the client calls `isAccessibilityEnabled()` via `DeviceAgentModule`.
   - If enabled: displays a success checkmark and auto-advances to the active agent view.
   - If still disabled: remains on the helper view with a "Check Again" button and troubleshooting hints.

---

## 3. Action Confirmation Dialogs & Safety Gates

### 3.1 Risk Tiers
Actions are categorized into three distinct risk tiers:
- **Low Risk (Auto-Execute):** Read screen, take screenshot, scroll, swipe, info, tap non-critical elements.
- **Medium Risk (Optional Confirmation / Session Bypass):** Open app, type text, make phone calls, search contacts.
- **High Risk (Mandatory Confirmation):** `send_communication` (SMS/messaging), `purchases` (in-app transactions), `deletions` (contacts, files), `settings_changes`, `play_installs`, `passwords_otps`, `sideloads`.

### 3.2 Contextual Action Inspector Card
Before executing any High-Risk (or unexempted Medium-Risk) action, the executor intercepts the tool call and triggers an in-app confirmation card:
- **Header:** Action title with risk badge (e.g. `⚠️ High Risk` or `Caution: Irreversible`).
- **Structured Payload Inspector:**
  - Target application or package (e.g., `com.whatsapp`).
  - Target element / label (e.g., `Button "Send"`, `Contact "Alice"`).
  - Executable payload or parameters (e.g., Message content: `"Meeting rescheduled to 3 PM"`).
- **Safety Copy:** *"Please verify the action details above. Vela will only execute this action upon your confirmation."*
- **Action Controls:**
  - `Cancel`: Immediately halts this action and informs the agent that the user rejected the request.
  - `Confirm Action`: Executes the action immediately.
  - `Don't ask again this session`: Checkbox that suppresses confirmation prompts for *this specific action type* for the remainder of the active session.

---

## 4. Read-Only Screen Mirror (Simplified DOM)

### 4.1 Architecture
The user needs visibility into what the agent "sees" without streaming heavyweight high-bandwidth video or screenshots. A simplified accessibility DOM mirror fulfills this:
- **Data Source:** Accessibility hierarchy tree obtained via `AccessibilityNodeInfo` (`rootInActiveWindow`).
- **Filtering & Simplification:**
  - Recursive traversal filters out invisible/empty layout containers (`isVisibleToUser == false`).
  - Extracts essential attributes: `className`, `text`, `contentDescription`, `viewIdResourceName`, `boundsInScreen`, `isClickable`, `isEditable`.
  - Maps to a simplified JSON DOM structure:
    ```json
    {
      "type": "button",
      "text": "Submit",
      "bounds": [120, 450, 360, 510],
      "clickable": true
    }
    ```
- **Privacy Masking:** Any node marked with `isPassword == true` or input elements containing sensitive text have their values masked as `••••••••`.
- **UI Representation:** A compact collapsible card showing a stylized wireframe / DOM tree outline of the active screen with the agent's target element highlighted in emerald/aurora accent.

---

## 5. Session-Only Action History

### 5.1 In-Memory Buffer
To ensure complete user privacy and compliance with data minimization:
- Action execution logs (`timestamp`, `actionType`, `target`, `status`, `summary`) are stored in an **in-memory circular buffer** (e.g., capped at 50 recent events).
- **Zero Disk Persistence:** The history is intentionally **not** written to SQLite or `AsyncStorage`.
- **Session Lifecycle:**
  - Initiated when a device automation session begins.
  - Rendered in the UI as a timeline of completed steps (e.g. `Opened WhatsApp → Tapped Search → Entered "Alice"`).
  - Completely purged when the session ends, when the user closes the sheet, or when the app process terminates.

---

## 6. Dual-Trigger Kill Switch Architecture

### 6.1 Requirements
In automated agent workflows, the user must have an immediate, zero-latency emergency escape hatch to interrupt runaway actions or misinterpretations.

### 6.2 Dual Triggers
1. **Active Floating Stop Overlay Button:**
   - Displayed as a high-contrast draggable floating button (`⏹ Stop`) rendered on screen *only* while an automation session is actively executing actions.
   - Automatically unmounts / dismisses when the agent is idle.
   - Tapping it triggers an immediate abort signal.
2. **Hardware Volume Key Press:**
   - The Android `AccessibilityService` listens for hardware key events via `onKeyEvent(event: KeyEvent?)`:
     ```kotlin
     override fun onKeyEvent(event: KeyEvent): Boolean {
         if (isAutomationRunning && event.action == KeyEvent.ACTION_DOWN) {
             if (event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || event.keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                 triggerEmergencyStop("Hardware volume key pressed")
                 return true // Consume key event
             }
         }
         return super.onKeyEvent(event)
     }
     ```
   - Pressing either Volume Up or Volume Down immediately fires the emergency abort.

### 6.3 Abort Execution Lifecycle
1. **Signal Native Abort:** Flag `isAutomationRunning` is set to `false`; any sleep, swipe, tap, or input dispatch in flight is canceled.
2. **Purge Action Queue:** Any upcoming planned steps in the client executor are discarded immediately.
3. **Log & Haptic Alert:**
   - Adds an `[Aborted by User]` event to the session action history.
   - Triggers device haptic vibration feedback.
   - Displays a banner: *"Agent stopped by user"*.
4. **State Reset:** Agent returns to the idle state awaiting further user prompt.

---

## 7. Implementation Blueprint for Ticket #611

The client implementation in Ticket #611 will integrate:
1. `client/components/device/AccessibilityPermissionModal.tsx`: 3-step onboarding modal with explainer, deep link trigger, and auto-detect polling.
2. `client/components/device/ActionConfirmationModal.tsx`: Contextual action inspector with payload preview, risk badge, and session bypass toggle.
3. `client/components/device/ScreenMirrorCard.tsx`: Read-only simplified DOM visualizer with privacy masking.
4. `client/components/device/SessionHistorySheet.tsx`: Ephemeral in-memory timeline of agent actions.
5. `client/components/device/FloatingKillSwitch.tsx`: Active-only draggable overlay stop button with volume key listener hook.
6. Integration into `client/utils/deviceActionExecutor.ts` and `client/app/settings/device-agent.tsx`.

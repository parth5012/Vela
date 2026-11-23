# Research: SYSTEM_ALERT_WINDOW & Floating Overlay Patterns in Expo / React Native

**Map Reference:** #596 — Floating Overlay (Mini-Chat Bubble)  
**Ticket Reference:** #598 — `[HITL] Research: SYSTEM_ALERT_WINDOW & overlay patterns on Android`  
**Date:** 2026-11-22  
**Status:** Completed

---

## 1. Executive Summary

A floating overlay (mini-chat bubble) allows users to access quick assistant capabilities (text, voice, image input) on demand while maintaining their workflow context. In a cross-platform Expo / React Native architecture (targeting Android as primary plus Web/iOS compatibility), implementing system-level overlays involves specific OS permissions, lifecycle constraints, and store policy implications.

This document evaluates:
1. Android OS mechanics for `SYSTEM_ALERT_WINDOW` and `WindowManager`.
2. Expo / React Native feasibility across system-level vs. in-app overlays.
3. Interaction patterns: edge-docking, mini-panel expansion, dismiss zones, and position persistence.
4. State synchronization with Vela's persistent SQLite chat store (`useChatStore`).
5. Recommended implementation blueprint for Ticket #599.

---

## 2. Android OS Mechanics

### 2.1 Permission Model: `SYSTEM_ALERT_WINDOW`
- **Manifest Requirement:**
  ```xml
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
  ```
- **Runtime Check:**
  Unlike standard runtime permissions (`requestPermissions`), Android treats overlay permission as a special app access setting:
  ```kotlin
  Settings.canDrawOverlays(context) // returns boolean
  ```
- **Permission Intent:**
  Apps cannot show a standard in-app permission dialog for `SYSTEM_ALERT_WINDOW`. Instead, they must launch the system settings screen:
  ```kotlin
  val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:" + context.packageName)
  )
  context.startActivity(intent)
  ```
  *Note:* Vela's `permissionManager.ts` already provides `buildSettingsDeepLink('overlay')` targeting `android.settings.action.MANAGE_OVERLAY_PERMISSION`.

### 2.2 System Window Management (`WindowManager`)
To display a system-level floating view above other applications:
- **Window Type:** `WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY` (mandatory on API 26+; replaces deprecated `TYPE_SYSTEM_ALERT` and `TYPE_PHONE`).
- **Flags:**
  - `FLAG_NOT_FOCUSABLE`: Allows touch events outside the bubble to pass through to underlying applications while collapsed; must be cleared when expanding a panel with text inputs so the IME (soft keyboard) can receive focus.
  - `FLAG_NOT_TOUCH_MODAL`: Ensures outside touches register for other apps unless tapping inside the overlay.
  - `FLAG_WATCH_OUTSIDE_TOUCH`: Detects when a tap occurs outside the expanded panel to automatically collapse or dismiss.
- **Service & Lifecycle:**
  Displaying a view when the app Activity is not in the foreground requires an Android `ForegroundService` with an ongoing notification (`android.permission.FOREGROUND_SERVICE` and Android 14+ `FOREGROUND_SERVICE_SPECIAL_USE`). Note that on Android 15 (API 35)+, `dataSync` foreground services have a strict 6-hour limit per 24-hour period and cannot be used for indefinite overlay persistence. An overlay service must use an appropriate long-running service type (`specialUse` with policy justification) or confine overlay operations to active user interactions. Without a foreground service, the OS kills background windows when memory pressure occurs.

---

## 3. Expo & React Native Feasibility Analysis

### Option A: Native Headless Android WindowManager Service
- **Mechanism:** A native Kotlin service creates a `WindowManager` window and attempts to host a React Native root view (`ReactRootView`) via a Headless JS context.
- **Drawbacks:**
  1. High risk of native crash: React Native's bridge and fabric renderer expect an attached Android `Activity` for window measurement, theming, keyboard avoidance, and modal hosting.
  2. Google Play Store Policy: Google strictly enforces `SYSTEM_ALERT_WINDOW` review requirements. Apps using system overlays for assistant chat bubbles frequently receive policy warnings unless classified as dialer, navigation, or accessibility tools.
  3. Non-portable: Breaks entirely on Web (Expo Web) and iOS.

### Option B: In-App Floating Overlay with Deep-Link System Gating (Recommended)
- **Mechanism:**
  - Render an interactive, draggable floating bubble directly in the root layout (`app/_layout.tsx` or top-level provider) above the navigation hierarchy.
  - Provide an on-demand permission toggle in Settings (`Floating Overlay`).
  - When enabled, check Android overlay permission. If not granted, present an explanatory rationale modal and deep-link directly to `openSettings('overlay')`.
  - Fall back gracefully to the in-app floating overlay across all screens within Vela (on Android, Web, and iOS), displaying an advisory badge if system overlay is ungranted.
- **Benefits:**
  1. Zero native crash risk, zero memory leak risk.
  2. Full access to React state, navigation, theme tokens (`useAurora`), and `useChatStore`.
  3. Clean fallback across Android, iOS, and Web.
  4. Fully compliant with Google Play Store policies.

---

## 4. Interaction & UI Specifications

### 4.1 Draggable Bubble & Edge-Docking
- **Dimensions:** 56×56 dp circular touch target with elevated shadow and theme-aware styling.
- **Gesture Handling:** `PanResponder` or Animated Pan gesture tracking `(x, y)`.
- **Docking Physics:**
  Upon release, calculate horizontal distance to left (`x = 16`) vs. right (`x = screenWidth - 72`). Animate horizontally to the nearest edge with a spring animation (`bounciness: 6, speed: 12`).
- **Vertical Clamping:** Clamp `y` between safe area top inset + 16 and screen bottom inset - 80 to prevent getting stuck under status bar or navigation bars.

### 4.2 Dismiss Target (Drop Zone)
- While dragging the bubble, reveal a circular or pill-shaped drop zone at the bottom center of the screen with an "✕" icon.
- When the bubble coordinates intersect the drop zone bounds (within ~48 dp radius), provide haptic feedback (`Haptics.impactAsync(ImpactFeedbackStyle.Medium)`) and scale up the drop zone.
- Releasing inside the drop zone hides the bubble and updates state to minimized/dismissed.

### 4.3 Mini-Chat Panel
- **Size:** Responsive width (clamped max 420 dp, 92% screen width on mobile) and ~55% screen height.
- **Content:**
  - Header: "Quick Chat" title, thread sync status indicator, minimize button ("─"), close button ("✕").
  - Message List: Compact scrollable bubble list displaying the latest messages from the Quick Chat thread.
  - Input Bar:
    - Text input with auto-expanding height.
    - Voice Input button (mic icon, togglable in Settings).
    - Image Attachment button (image icon, togglable in Settings).
    - Send button.

---

## 5. Thread Model & Synchronization

### 5.1 Dedicated Quick Chat Thread
- Rather than mutating the currently active main chat thread, the floating overlay binds to a dedicated thread:
  ```ts
  const QUICK_CHAT_THREAD_ID = '1db65310-8cf7-52aa-a370-c2f0ab8ce187';
  ```
- **Lifecycle & Persistence:**
  - Initialized automatically if absent: identified by the canonical RFC-4122 UUID `QUICK_CHAT_THREAD_ID = '1db65310-8cf7-52aa-a370-c2f0ab8ce187'` (derived via backend `uuid5(NAMESPACE_VELA, 'quick-chat-thread')`) with title `'Quick Chat'`.
  - Persisted in SQLite local DB via standard `saveThread()` and `saveMessage()`.
  - Full support for streaming assistant responses using `streamController`.
  - Synchronized in real time: any messages sent from the overlay immediately appear in the thread list and can be viewed/continued in the main chat view without state divergence.

### 5.2 Capability Toggles in Settings
In `useConfigStore`, add:
```ts
export interface FloatingOverlayConfig {
  enabled: boolean;
  dockSide: 'left' | 'right';
  dockY: number;
  enableVoice: boolean;
  enableImages: boolean;
}
```
Settings UI provides:
1. Floating Overlay toggle (master on/off).
2. Permission status indicator (System Overlay: Granted / Denied / Fallback).
3. "Voice Input in Overlay" switch.
4. "Image Attachments in Overlay" switch.
5. "Reset Overlay Position" button.

---

## 6. Implementation Plan for Ticket #599

1. **State & Configuration:**
   - Update `useConfigStore.ts` with `floatingOverlay` settings (enabled, dockSide, dockY, enableVoice, enableImages).
   - Ensure `permissionManager.ts` supports overlay status checking and settings launch.

2. **Components (`client/components/overlay/`):**
   - `FloatingBubble.tsx`: Draggable, edge-docking, dismiss-detecting circular button.
   - `MiniChatPanel.tsx`: Compact chat panel with message history, text input, voice, and image options.
   - `DismissDropZone.tsx`: Bottom animated dismiss target.
   - `FloatingOverlayRoot.tsx`: Top-level orchestrator mounted in `client/app/_layout.tsx`.

3. **Settings Integration:**
   - Add "Floating Overlay" card in `client/app/settings/permissions.tsx` or a dedicated settings section.

4. **Verification:**
   - Run `npm test` and `npx tsc --noEmit` in `client/`.
   - Ensure all edge-case gestures and thread synchronization pass unit tests.

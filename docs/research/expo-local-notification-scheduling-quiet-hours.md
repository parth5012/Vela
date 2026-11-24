# Research: Local Notification Scheduling, Quiet Hours & Deferred Delivery in Expo

**Issue**: #606 (Part of Map #604)  
**Date**: November 2026  
**Status**: Completed  
**Author**: Antigravity  

---

## 1. Executive Summary

This research establishes best practices for implementing **Quiet Hours (single window, deferred delivery)** and **Per-Channel Notification Toggles** in Vela's Expo React Native mobile client.

Key constraints & verified requirements:
- **Zero backend dependency**: All settings and deferral queues must persist locally using `AsyncStorage`.
- **Single quiet window**: Supports cross-midnight time windows (e.g., 22:00 to 07:00).
- **Deferred delivery**: Notifications triggered during quiet hours must not be permanently discarded; instead, their delivery is deferred to the immediate conclusion of quiet hours (the next `endTime`).
- **Channel granularity**: 5 user-facing channels (`task_completion`, `calendar_reminder`, `briefing`, `checkin`, `approval`), individually toggleable.
- **Expo Notifications compatibility**: Operates cleanly with `expo-notifications` on Android (channels + local triggers) and iOS (system notifications).

---

## 2. Expo Notifications Architecture & Primitives

Expo's `expo-notifications` module provides two distinct presentation pathways:
1. **Immediate / Foreground Presentations** via `setNotificationHandler`:
   ```ts
   Notifications.setNotificationHandler({
     handleNotification: async (notification) => {
       const shouldSuppress = isSuppressedByQuietHours(notification);
       return {
         shouldShowAlert: !shouldSuppress,
         shouldPlaySound: !shouldSuppress,
         shouldSetBadge: false,
         shouldShowBanner: !shouldSuppress,
         shouldShowList: !shouldSuppress,
       };
     },
   });
   ```
2. **Scheduled Local Delivery** via `scheduleNotificationAsync`:
   ```ts
   await Notifications.scheduleNotificationAsync({
     identifier,
     content: { title, body, data },
     trigger: dateTrigger ?? null,
   });
   ```

### 2.1 The Cross-Midnight Time Window Problem

Quiet hours typically span across midnight (e.g. `22:00` to `07:00`). A timestamp $t$ (hour $H$, minute $M$) falls within $[S, E]$ when:
- If $S \le E$ (same-day window, e.g. 13:00 to 15:00):
  $$t \ge S \land t < E$$
- If $S > E$ (overnight window, e.g. 22:00 to 07:00):
  $$t \ge S \lor t < E$$

When a notification arrives during quiet hours, the deferred delivery target is the **next occurrence of $E$**:
- If $S > E$:
  - If $t \ge S$ (e.g. 23:30): $E$ occurs on the *next calendar day* at 07:00.
  - If $t < E$ (e.g. 02:15): $E$ occurs on the *same calendar day* at 07:00.
- If $S \le E$:
  - $E$ occurs on the *same calendar day* at $E$.

---

## 3. Deferred Delivery Strategy

### 3.1 Gated Scheduling Pipeline

When any subsystem (task runner, briefing, check-in, or backend FCM event) attempts to dispatch a notification:

```
Notification Request (Channel C, Content, Target Time)
                       │
                       ▼
           Is Channel C Enabled?
             ├── NO  ──> Discard (Drop notification)
             └── YES ──> Is Quiet Hours Enabled?
                           ├── NO  ──> Deliver immediately / as originally scheduled
                           └── YES ──> Is Target Time inside Quiet Hours?
                                         ├── NO  ──> Deliver immediately
                                         └── YES ──> Calculate `nextQuietHoursEnd`
                                                     Schedule with `DATE` trigger at `nextQuietHoursEnd`
                                                     Add `{ deferred: true }` to notification data
```

### 3.2 Deferred Queue Persistence vs Expo Native Triggers

Two implementation options were evaluated:

| Approach | Mechanics | Pros | Cons |
|---|---|---|---|
| **A. Native Expo Trigger Deferral** | Call `scheduleNotificationAsync` with `trigger: { type: DATE, date: nextQuietHoursEnd }` | • Survives app termination<br>• Android AlarmManager/iOS APNs delivers automatically at 07:00 even if app is closed<br>• Zero background polling needed | Requires notification identifier management to prevent spamming |
| **B. In-Memory / SQLite Queue** | Store in DB, run foreground timer/cron to flush when quiet hours end | Full application-level control over message collation | Does NOT fire if the phone is locked or app is in deep sleep |

**Recommended Solution**: **Approach A (Native Expo Date Trigger)**.
By scheduling directly with Expo's `DATE` trigger targeting the exact timestamp when quiet hours end:
- The OS delivers the notification at 07:00 sharp without requiring an active foreground JS loop.
- The notification payload retains original route and metadata (`data.deferred = true`).
- If quiet hours are edited or disabled in settings, `cancelScheduledNotificationAsync` cleans up pending deferred identifiers.

---

## 4. Per-Channel Filtering Design

Vela defines 5 logical channels:
1. `task_completion`: Foreground and background agent task completions.
2. `calendar_reminder`: Calendar sync alerts and upcoming meeting warnings.
3. `briefing`: Morning briefing notifications.
4. `checkin`: Evening check-in prompts.
5. `approval`: Safety / action approvals.

### 4.1 Android System Channels vs Client-Side Gate
On Android 8.0+, system channels (`setNotificationChannelAsync`) allow OS-level notification controls. However:
- OS channel changes cannot be detected reactively in JavaScript.
- OS channels cannot perform deferred delivery (the OS simply silences or drops the alert immediately).
- iOS does not support Android notification channels.

Therefore, Vela's client-side settings act as the **primary gating layer**:
- When a channel is toggled OFF in Vela settings, notifications for that channel are blocked before reaching Expo's scheduler.
- Android system channels remain registered for OS sound/vibration categorization.

---

## 5. Settings Store Schema & API

```ts
export interface QuietHoursConfig {
  enabled: boolean;
  startHour: number;   // 0 - 23 (default: 22)
  startMinute: number; // 0 - 59 (default: 0)
  endHour: number;     // 0 - 23 (default: 7)
  endMinute: number;   // 0 - 59 (default: 0)
}

export interface ChannelSettings {
  task_completion: boolean;
  calendar_reminder: boolean;
  briefing: boolean;
  checkin: boolean;
  approval: boolean;
}

export interface NotificationSettings {
  quietHours: QuietHoursConfig;
  channels: ChannelSettings;
}
```

Persisted via `AsyncStorage` key `vela.notification.settings` through a lightweight Zustand store `useNotificationStore`.

---

## 6. Verification Plan

1. **Unit Tests** (`client/__tests__/notificationSettings.test.ts`):
   - Correctness of `isWithinQuietHours`:
     - Cross-midnight (22:00 - 07:00): 23:00 (true), 04:00 (true), 08:00 (false), 21:59 (false).
     - Same-day (09:00 - 17:00): 10:00 (true), 18:00 (false).
   - Calculation of `getNextQuietHoursEnd`:
     - At 23:30, returns 07:00 tomorrow.
     - At 03:00, returns 07:00 today.
   - Channel filtering:
     - Disabled channel returns `shouldDeliver: false`.
     - Enabled channel within quiet hours returns `{ shouldDeliver: true, deferredDate: Date }`.
   - Store hydration and persistence:
     - Updates persist to `AsyncStorage`.
     - Defaults load correctly on clean state.
2. **Typecheck & Linter**:
   - `npx tsc --noEmit` cleanly passes.
   - `npm test` runs with 100% green suites.

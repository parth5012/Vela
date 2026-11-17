# Research: Subtle Animation Patterns in Modern Apps & React Native

**Map**: [#576](https://github.com/parth5012/Vela/issues/576)  
**Ticket**: [#578](https://github.com/parth5012/Vela/issues/578)

---

## 1. Executive Summary

Modern high-craft interfaces—such as T3 Code, Linear, Superhuman, and iOS/Android system components—rely on subtle micro-interactions to create a feeling of tactility, speed, and responsiveness without adding visual clutter or cognitive load. In mobile environments like React Native, animations must be designed around strict performance and accessibility constraints:
1. **Zero UI-Thread Jitter**: Heavy or poorly scoped animations block the React render loop. All micro-interactions must run on the native driver via `transform` and `opacity`.
2. **Intentional Curves**: Bouncy or rubber-band animations make productivity tools feel sluggish. Deceleration/ease-out curves front-load progress so UI responds instantaneously to user input.
3. **Inclusive Motion**: Accessibility is a first-class requirement. Respecting `prefers-reduced-motion` ensures animations do not cause vestibular discomfort.

---

## 2. Interaction Patterns in Modern Polished Apps

### A. Press & Tactile Feedback
- **Pattern**: When a user taps a button or card, modern apps apply a micro-scale (e.g. `0.97`–`0.98`) or subtle opacity shift.
- **Timing**: Instant reaction upon `pressIn` (120–150ms ease-out) and rapid recovery upon `pressOut` (150ms).
- **Benchmark**: T3 Code / Linear buttons depress slightly, signaling receipt of touch before any async action completes.

### B. Badge & Status Transition
- **Pattern**: Counters and notification badges (e.g., pending sync queue or unread counts) should not abruptly jump into existence.
- **Transition**: Smooth scale-in from `0.8` to `1.0` combined with fade-in (`opacity` `0` → `1`) over 150–200ms.
- **State Changes**: When a status indicator changes state (e.g., from `online` to `syncing` or `offline`), a subtle cross-fade or scale pulse highlights the change without flashing.

### C. List Item & Selection Delight
- **Pattern**: List rows and items (like chat threads or settings options) give feedback on press and transition smoothly between active and inactive states.

---

## 3. React Native Implementation Architecture

### A. React Native `Animated` with Native Driver
- Built-in `Animated` using `useNativeDriver: true` directly binds animation values to the native view hierarchy.
- **Constraint**: Only `transform` (`scale`, `translateX`, `translateY`, `rotate`) and `opacity` can run on the native driver. Layout attributes (`width`, `height`, `margin`, `padding`) require the JS thread and are banned for micro-animations.
- **Benefit**: Zero JS-thread serialization overhead during execution, 60fps/120fps fluid execution even during intensive React re-renders.

### B. Motion Tokens & Easing
The repository's motion contract (`client/utils/motion.ts`) defines:
- **Easing Curve**: `EASING.out = Easing.bezier(0.23, 1, 0.32, 1)`. All motion is front-loaded; acceleration curves (`ease-in`) and decelerate-then-accelerate curves are prohibited.
- **Durations**:
  - `DURATIONS.press`: 150ms (window: 120–180ms)
  - `DURATIONS.reveal`: 200ms (window: ≤300ms)
  - `DURATIONS.transition`: 280ms (window: ≤300ms)
  - `DURATIONS.stagger`: 50ms (window: 30–80ms)

---

## 4. Accessibility & Reduced Motion

Users with vestibular disorders or motion sensitivity can experience nausea or disorientation from scaling, parallax, and translation movements.

### Accessibility Protocol:
1. Hook into OS settings via `useReducedMotion()` (`AccessibilityInfo.isReduceMotionEnabled()`).
2. When reduced motion is enabled:
   - Completely disable `scale` and `translation` transforms.
   - Retain only color and opacity changes that communicate essential status or interactive affordances.
   - Ensure screen-reader announcements (`accessibilityLabel`, `accessibilityState`) remain fully intact.

---

## 5. Applied Component Targets in Vela

1. **`SyncStatusIndicator` / `HealthIndicator`**:
   - Wrap status dot in `Animated.View`.
   - On state change (`online` ↔ `syncing` ↔ `offline`), perform a gentle fade & scale pulse (scale `0.85` → `1.0`, opacity `0.4` → `1.0`, duration 200ms).
   - Under reduced motion, bypass scale transform and execute a clean opacity transition.
2. **`QueueBadge`**:
   - Wrap the badge in `Animated.View`.
   - Animate appearance and count updates using scale (`0.8` → `1.0`) and opacity (`0` → `1.0`) with `EASING.out`.
   - When count returns to `0`, fade out cleanly before unmounting.
3. **`PressableScale`**:
   - Verify press scale `0.97` across interactive components.
4. **`ThreadRow`**:
   - Ensure active thread indicators and press feedback respect motion tokens and reduced-motion settings.

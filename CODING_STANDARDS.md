# Vela Coding Standards (Reviewer Agent Guide)
**Version:** 1.0 (2026-11-14)

This document specifies reviewer-enforced coding standards for pull requests and code modifications in Vela. Mechanical syntax and style rules are handled automatically by linters (Ruff and ESLint); this file is reserved strictly for non-mechanical architectural and behavioural judgement calls.

---

## 1. Async Cancellation & Lifecycle Hygiene

- **Synchronous Cancellation Flags**: Any async class or hook exposing `cancel()` / `abort()` that guards in-flight initialization or work must set a boolean flag (`this.cancelRequested = true` / `cancelInProgress = true`) **synchronously at the start of the method**, before its first `await`. Do not rely on awaited promises to check cancellation, as microtask FIFO ordering allows new async operations to start before older cleanup handlers resume.
  ```typescript
  // CORRECT: synchronous flag set before any microtask boundary
  async cancel() {
    this.cancelRequested = true;
    if (this.initPromise) {
      await this.initPromise.catch(() => {});
    }
  }
  // ANTI-PATTERN: awaiting before setting flag lets pending ticks race
  async cancel() {
    await this.cleanupAsync(); // race condition: in-flight worker proceeds
    this.isCancelled = true;
  }
  ```
- **Fail-Safe Cleanup in `finally`**: Cleanup operations inside `finally` blocks must wrap `await` calls in explicit `try / catch` blocks. Chaining `.catch()` directly on a promise in `finally` fails to catch synchronous exceptions and can swallow the original error or corrupt teardown.
- **State Reset on Init Rejections**: If an async runner or downloader asserts a re-entrancy guard (e.g. `if (this.isDownloading) return;`), it must guarantee the flag is reset on every initialization rejection or failure branch; otherwise all subsequent retries remain permanently bricked.

---

## 2. Streaming State & UI Store Isolation

- **Divert-Aware Token Buffering**: High-frequency streaming tokens must be routed to an ephemeral UI store (`useActiveStreamStore`) rather than directly appending to the persisted conversation history store (`useChatStore`). Writing tokens directly to persisted stores on every token causes $O(N^2)$ React tree reconciliations and UI jank.
- **Finalization & Flush Folding**: Stream finalization must fold all buffered tokens into the persistent message store via a single sanitizing and debounce-clearing commit (`updateLastMessageContent`), ensuring cross-thread background streams do not wipe active overlays or orphan placeholder turns.
- **Non-Swallowed Stream Errors**: Background runners and stream controllers must never swallow non-abort errors; fire-and-forget call sites must cleanly catch or route errors to user-facing diagnostic banners.

---

## 3. Evaluation Seams & Fail-Closed Safety

- **Fail-Closed Execution**: Evaluation pipelines (`VELA_EVAL_MODE=1` or `eval-thread-*`) must never execute destructive production actions (e.g., sending emails, deleting events, running physical ADB shell commands, or inserting into production database tables).
- **Honest Provenance Disclosure**: Offline evaluations and heuristic fallbacks must explicitly disclose their evaluation mode (e.g. `evaluation_mode="heuristic"` or `provider="mock"`). A test run must never mask an unreached or missing live provider as a fake green live pass.

---

## 4. Mobile Hardware & Native Bridge Boundaries

- **Physical Device Safety Policy**: Physical ADB-connected devices are personal hardware. Automated test harnesses must enforce explicit serial checks to reject physical devices and require emulator environments.
- **C++ / JNI String Boundary Guards**: JNI native modules must guard against null pointers (`GetStringUTFChars`, `ReleaseStringUTFChars`) to avoid `SIGABRT` crashes under Android CheckJNI. Empty optional string parameters must collapse to `"[]"` or empty tokens rather than null pointers.

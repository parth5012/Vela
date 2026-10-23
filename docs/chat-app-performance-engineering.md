# Chat App Performance Engineering & Regression Ratchets
> Reverse-engineering world-class chat applications (T3 Chat, Claude.ai, Telegram) and establishing deterministic performance benchmarks for Vela (Expo + React Native + Hermes + Android).

---

## 1. Executive Summary & Core Philosophy

Fast AI and chat applications do not happen by accident; they are engineered through measurement and ruthless architectural discipline. As demonstrated by Anthropic's sprint to make Claude.ai 3x faster and Theo's (T3.gg) analysis:

> **"Anything we could count, we could climb."**  
> — *Anthropic Engineering / Theo (t3.gg)*

When developers guess why an app feels slow, they waste time optimizing non-bottlenecks. When every critical user journey is broken into discrete, countable milestones (wall-clock milliseconds, React render commits, AST parsing durations, OS frame drops) and guarded by **performance ratchets** (automated gates that reject regressions), performance consistently improves and never slips backward.

Furthermore, following Matt Pocock's agentic principle (*"Give your agent a goal, and let it be creative"*), having an automated benchmark harness allows an AI agent or engineer to iteratively run profiling, implement targeted optimizations, and quantitatively verify deltas against a locked baseline.

---

## 2. Reverse-Engineering What Makes Top Chat Apps Fast

When analyzing applications like **T3 Chat**, **Claude.ai**, and **Telegram**, five architectural principles emerge:

### 2.1. Sub-16ms Optimistic Action Latency
- **The Golden Rule**: The moment the user taps "Send" or presses Enter, the user message bubble must paint on screen in **less than 1 frame (< 16.6ms)**.
- **How they do it**: The UI thread state updates immediately with a temporary local ID. Network serialization, SQLite writes, and socket handshakes are queued asynchronously and do not block the render loop.
- **Common RN Pitfall**: Synchronously awaiting async storage/DB writes, re-sorting message arrays, or recalculating layout geometry before painting the bubble.

### 2.2. Isolated Streaming Scopes (Zero List Re-render)
- **The Golden Rule**: Streaming 50 to 100 tokens per second must **never** re-render the parent screen, the message list, or previous message bubbles.
- **How they do it**: The active streaming bubble subscribes to an isolated token stream or micro-store. The list data array itself remains untouched until the stream finishes or commits at coarse intervals.
- **Common RN Pitfall**: Calling `appendToken` on a global store where the screen root subscribes to `messages[threadId]`. This triggers a full screen re-render, list reconciliation, and flat list item diffing on every incoming chunk.

### 2.3. Decoupled Token Ingestion & AST Parsing
- **The Golden Rule**: Incoming network chunk frequency must be decoupled from UI paint frequency, and Markdown AST parsing must not thrash the JavaScript event loop.
- **How they do it**: Tokens are buffered into 60–100ms render ticks (or `requestAnimationFrame`), and Markdown parsing is either performed incrementally or cached so that 1,000 words are not re-parsed from regex scratch on every token.
- **Common RN Pitfall**: Re-running full regex and AST generation across the entire accumulated text on every single 100ms tick via `react-native-markdown-display`.

### 2.4. Recycled Views & Flat Memory
- **The Golden Rule**: Scrolling through 200+ complex messages containing Markdown, code snippets, and math formulas must remain at solid 60/120 FPS with flat memory consumption.
- **How they do it**: Recycled cell architectures (e.g. Shopify FlashList) and deterministic cell height estimates avoid unmounting and recreating heavy native view hierarchies.

### 2.5. Keystroke Priority & Event Loop Concurrency
- **The Golden Rule**: While an AI model is streaming long responses, the user must be able to type in the input box with zero perceived input lag (< 30ms).
- **How they do it**: User input is given highest priority. If the JS thread is swamped by token processing, typing drops characters or stutters.

---

## 3. The 3-Tier Metric Suite for Vela

To eliminate subjectivity, we establish three measurement tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tier 1: User-Perceived Speed                     │
│  • Time-to-Typeable (TTT)           • Send Action Latency (Tap-to-Bubble)│
│  • Time-to-First-Token (TTFT)        • Total Streaming Duration           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────┴────────────────────────────────────┐
│                    Tier 2: Framework & Runtime Budget                  │
│  • React Render Commits per Stream   • Markdown AST Parse Time (ms)      │
│  • Redundant Cell Re-renders        • JS Event Loop Delay Under Load    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────┴────────────────────────────────────┐
│                      Tier 3: Native OS & Hardware Health               │
│  • Android Jank Frame % (> 16.6ms)   • P95 & P99 Frame Durations          │
│  • Dalvik/Native PSS Memory Growth   • Cold Process Startup (am start -W) │
└────────────────────────────────────────────────────────────────────────┘
```

### Detailed Metrics & Targets

| Metric ID | Name | Measurement Points | Target (T3/Gold) | Vela Target |
|---|---|---|---|---|
| **M1** | **Time-to-Typeable (TTT)** | From process launch until chat input is focused and accepts keys | `< 1,000 ms` | `< 1,400 ms` |
| **M2** | **Send-to-Bubble Latency** | `onPress(Send)` → User bubble `onLayout` / paint | `< 16 ms` (1 frame)| `< 30 ms` |
| **M3** | **Time-to-First-Token (TTFT)**| `onPress(Send)` → First assistant chunk visible | Server + `< 50 ms` | Server + `< 80 ms` |
| **M4** | **Render Commits per Stream**| React commit count during a 100-token stream | `< 15 commits` | `< 25 commits` |
| **M5** | **Markdown Parse Overhead** | Total ms spent in Markdown regex / AST per 500 words | `< 5 ms` | `< 12 ms` |
| **M6** | **Jank Frame Percentage** | % of frames exceeding 16.6ms during active stream | `< 2.0%` | `< 4.0%` |
| **M7** | **Scroll Smoothness** | Flinging through 100 messages | `> 98%` smooth | `> 95%` smooth |
| **M8** | **Session Memory Growth** | Memory delta (PSS) after 10 back-and-forth turns | `< 15 MB` | `< 25 MB` |

---

## 4. Testing Expo + Gradle Android Without WebLab Limitations

Testing mobile performance accurately differs from web apps because of the native bridge and split threads (Hermes JS thread vs Android UI render thread).

### The 4-Part Testing Architecture

```
┌────────────────────────────────────────────────────────┐
│               Automated Benchmark Harness              │
│       (Python / Bash runner + Mock FastAPI server)     │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
        ADB Automation & OS        In-App Telemetry
        ───────────────────        ────────────────
        • am start -W (startup)    • performance.now() marks
        • dumpsys gfxinfo (FPS)    • SSE chunk-to-paint timing
        • dumpsys meminfo (PSS)    • Logcat [VELA_PERF] tags
```

### 1. Zero-Flake Deterministic Mock Server (`client/e2e/mock_server.py`)
- Emits synthetic SSE responses at fixed intervals (e.g. exactly 50 tokens/sec at 20ms delta).
- Eliminates external internet speed, OpenAI/Anthropic latency, and cloud API variance.
- Guarantees that any timing change is **100% caused by client code changes**.

### 2. High-Resolution In-App Telemetry (`client/utils/perfTracker.ts`)
- Leverages Hermes `performance.now()`.
- Records timestamps on user tap, store updates, and component `onLayout`.
- Emits structured JSON to Android logcat:
  ```json
  [VELA_PERF] {"metric": "send_to_bubble_ms", "value": 21.4, "runId": 1}
  ```

### 3. Android System Profiling (`dumpsys gfxinfo`)
- The Android Hardware Renderer tracks every frame rendered on screen.
- We pull exact frame stats via ADB:
  ```bash
  # Reset frame counters
  adb -s emulator-5554 shell dumpsys gfxinfo com.parth5012.client.dev reset

  # Trigger streaming or fling scroll...

  # Extract exact frame percentiles & jank count
  adb -s emulator-5554 shell dumpsys gfxinfo com.parth5012.client.dev framestats
  ```

### 4. Automated Regression Ratchet (`client/e2e/ratchet.py`)
- Compares `results/current.json` against `results/baseline.json`.
- Calculates percentage differences:
  $$\Delta = \frac{\text{current} - \text{baseline}}{\text{baseline}} \times 100$$
- If any metric regresses by more than **10%**, the test suite exits with code `1`, blocking CI merge.

---

## 5. Identified Bottlenecks in Vela & Optimization Strategy

An audit of Vela's client codebase reveals the key areas to optimize:

### Bottleneck 1: Global Store Thrashing During Streaming
- **Location**: `client/store/useChatStore.ts` (`appendToken`) & `client/app/index.tsx`
- **Issue**:
  ```typescript
  // appendToken updates the entire thread array reference:
  messages: {
    ...state.messages,
    [threadId]: [...current.slice(0, -1), updatedLast]
  }
  ```
  `client/app/index.tsx` subscribes to `messages[activeThreadId]` and runs:
  ```typescript
  const reversedMessages = useMemo(() => [...activeMessages].reverse(), [activeMessages]);
  ```
  **Consequence**: Every 100ms, the entire screen re-renders, the entire message list re-reconciles, and `FlatList` diffs all items.
- **Optimization**: Decouple the streaming token into a dedicated transient store (`useStreamingStore`) or stream buffer that only the active bubble subscribes to. Update the main `messages` array only when streaming completes.

### Bottleneck 2: Markdown AST Parsing on Every Tick
- **Location**: `client/components/chat/RichText.tsx`
- **Issue**: `RichText` calls `parseContent` and renders `Markdown` from `react-native-markdown-display` on every tick of the streaming message. As the response grows from 50 to 500 words, parsing time increases exponentially.
- **Optimization**: For the active streaming message, render lightweight plain text / partial markdown buffer, or cache parsed AST blocks so completed paragraphs are never re-parsed.

### Bottleneck 3: FlatList vs Recycled List
- **Location**: `client/app/index.tsx`
- **Issue**: Standard `FlatList` unmounts and remounts complex message bubbles containing LaTeX, Code blocks, and Markdown during fast scrolling.
- **Optimization**: Migrate to `@shopify/flash-list` with estimated cell sizes and memoized message components (`React.memo` with custom comparator).

---

## 6. Implementation Roadmap

1. **Step 1: In-App Telemetry & Logcat Emitter**
   - Implement `client/utils/perfTracker.ts` and attach markers to `handleSend`, `RichText`, and SSE callbacks.
2. **Step 2: Deterministic Mock Benchmark Endpoint**
   - Add `/chat/benchmark` endpoint to `client/e2e/mock_server.py`.
3. **Step 3: Benchmark Runner & Ratchet Script**
   - Create `client/e2e/benchmark.py` and `client/e2e/ratchet.py`.
4. **Step 4: Establish Initial Baseline**
   - Run benchmark on release APK to generate `results/baseline.json`.
5. **Step 5: Execute Optimizations & Ratchet Forward**
   - Apply isolated streaming store and verify the delta.

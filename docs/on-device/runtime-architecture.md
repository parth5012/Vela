# On-Device Inference Runtime Architecture & Internal Bridge

> **Ticket**: [WF-06 (#415)](https://github.com/parth5012/Vela/issues/415)  
> **Parent Map**: [Wayfinder Map 1: On-device AI for Vela (#425)](https://github.com/parth5012/Vela/issues/425)  
> **Feeds**: [WF-07 Tool Calling (#416)](https://github.com/parth5012/Vela/issues/416), [WF-09 Benchmark Harness (#418)](https://github.com/parth5012/Vela/issues/418)  
> **Dependencies**: [WF-02 Prototype Spike (#423)](https://github.com/parth5012/Vela/issues/423), [WF-05 Model Download Gate (#420)](https://github.com/parth5012/Vela/issues/420)

---

## 1. Overview & Architecture

The **Inference Foreground Service** is the central execution runtime for on-device AI in Vela. It manages native model weights in process memory, isolates execution from the React Native UI thread, enforces MiniCPM5-2B model card sampling defaults, presents sticky Android foreground notifications with user-controlled cancellation, and responds to OS-level memory pressure and thermal events.

```text
┌────────────────────────────────────────────────────────┐
│                   React Native UI Layer                │
│             (ChatFeed, LocalAiScreen, Voice UI)         │
└───────────────────────────┬────────────────────────────┘
                            │ InferenceRequest
                            ▼
┌────────────────────────────────────────────────────────┐
│             InferenceForegroundService                 │
│  - Lazy Load / Idle Unload (5-min timeout)             │
│  - Persistent Notification & Stop Action               │
│  - Model Card Defaults (temp=1.0, top_p=0.95, min_p=0) │
│  - Memory & Thermal Pressure Watchdogs                 │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
        Token Streaming             Memory / Thermal
               │                    Throttling Events
               ▼                          ▼
┌──────────────────────────┐    ┌────────────────────────┐
│   Native Driver Bridge   │    │  Cloud Fallback Bridge │
│   (LiteRT-LM / OpenCL)   │    │  (On CRITICAL Memory)  │
└──────────────────────────┘    └────────────────────────┘
```

---

## 2. Model Card Sampling Defaults

MiniCPM5-2B uses hybrid reasoning with strict sampling hyperparameters specified in its model card:

| Parameter | Default Value | Rationale |
|---|---|---|
| `temperature` | **1.0** | Preserves calibrated logits distribution for hybrid reasoning tokens. |
| `top_p` | **0.95** | Nucleus sampling bounds candidate tokens without truncating valid reasoning chains. |
| `min_p` | **0.0** | Retains standard distribution filtering without aggressive tail clipping. |
| `maxTokens` | **2048** | Bounded generation ceiling to prevent runaway context generation. |

---

## 3. Lifecycle & Memory Management

### 3.1 Lazy Loading

The service does not allocate the ~1.55 GB model artifact or runtime KV cache into RAM at application startup. Instead, `ensureLoaded()` is triggered lazily upon the arrival of the first generation request.

### 3.2 Idle Unload (5-Minute Window)

To protect host battery life and prevent the Android OS from terminating background apps, the service starts an idle timer when active generation reaches 0. If no subsequent requests are submitted within `idleTimeoutMs` (default: 5 minutes / 300,000 ms), `stop()` is automatically invoked to unload model weights and release physical RAM.

### 3.3 Sticky Android Foreground Notification

While the model resides in RAM or is actively generating tokens, the service posts an ongoing Android foreground notification (`vela-inference-active`):
- **Title**: `Vela AI Engine Active`
- **Body**: `Generating response...` or `MiniCPM5-2B loaded in memory`
- **Actions**: `Stop` button allowing immediate teardown.

---

## 4. Memory & Thermal Throttling Strategy

In accordance with **WF-01 (DECISIONS.md)**:

```text
[System Memory Warning]
        │
        ├── TRIM_MEMORY_RUNNING_MODERATE ──► Prune Context Window: 4096 ──► 1024 tokens
        │
        └── TRIM_MEMORY_RUNNING_CRITICAL ──► Abort Inference ──► Unload Model ──► Notify Cloud Fallback
```

### 4.1 Moderate Pressure (`TRIM_MEMORY_RUNNING_MODERATE`)
- The active context window limit is pruned from **4096** to **1024** tokens.
- KV cache pages are compacted, reclaiming ~300 MB of runtime memory.

### 4.2 Critical Pressure (`TRIM_MEMORY_RUNNING_CRITICAL`)
- Any in-flight generation is aborted.
- `stop()` is immediately called, freeing all native buffers and releasing RAM to the OS.
- `onCloudFallbackRequired` triggers the seamless transition to the OpenAI-compatible remote gateway (WF-10).

### 4.3 Thermal Management
- At `status: 'serious'`, generation rate is throttled.
- At `status: 'critical'`, inference halts and the model is unloaded to avoid thermal shutdown.

---

## 5. Streaming Interface & Off-UI-Thread Execution

The service communicates via the `InferenceRequest` interface:

```typescript
export interface InferenceRequest {
  requestId: string;
  prompt: string;
  samplingParams?: Partial<InferenceSamplingParams>;
  systemPrompt?: string;
  onToken: (token: string) => void;
  onError?: (error: Error) => void;
  onComplete?: (result: {
    text: string;
    tokenCount: number;
    durationMs: number;
    tokPerSec: number;
  }) => void;
  signal?: AbortSignal;
}
```

- **Off-UI-Thread Yielding**: Microtasks and worker dispatch guarantee that the React Native JavaScript thread remains responsive to touch gestures and 60/120 FPS animations.
- **Cancellation**: The caller provides an standard `AbortSignal`. If `abort()` is signaled, token emission terminates immediately and native execution stops.

---

## 6. Implementation Reference

- Implementation: `client/utils/inferenceService.ts`
- Test Suite: `client/__tests__/inferenceService.test.ts` (9/9 tests passing)
- Prototype Harness: `client/spike/MiniCpmSpike.ts`
- Feasibility Reference: `docs/on-device/minicpm5-2b-litertlm-feasibility.md`

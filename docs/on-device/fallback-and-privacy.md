# Cloud Fallback Path & Privacy Disclosure Architecture

> **Ticket**: [WF-10 (#419)](https://github.com/parth5012/Vela/issues/419)  
> **Parent Map**: [Wayfinder Map 1: On-device AI for Vela (#425)](https://github.com/parth5012/Vela/issues/425)  
> **Feeds**: First-run onboarding flow, runtime model switcher, settings UI  
> **Dependencies**: [WF-01 Product Decisions (#424)](https://github.com/parth5012/Vela/issues/424), [WF-05 Model Download Gate (#420)](https://github.com/parth5012/Vela/issues/420), [WF-06 Runtime Architecture (#415)](https://github.com/parth5012/Vela/issues/415)

---

## 1. Overview & Unified Provider Abstraction

Vela is designed as an **offline-first, privacy-prioritized assistant**. To ensure service continuity across varying device hardware tiers and dynamic system conditions, Vela implements a unified provider abstraction (`UnifiedAiRouter` & `AiExecutionProvider`) that unifies local on-device execution (MiniCPM5-2B via LiteRT-LM) and remote cloud execution (OpenAI-compatible endpoints) behind a single polymorphic interface.

```text
┌─────────────────────────────────────────────────────────────────┐
│                      Unified AI Router                          │
│               (Runtime Mode: auto_fallback)                     │
└───────────────────────────────┬─────────────────────────────────┘
                                │
          ┌─────────────────────┴─────────────────────┐
          │                                           │
          ▼                                           ▼
┌───────────────────────────────┐           ┌───────────────────────────┐
│   On-Device Execution Engine  │           │ OpenAI-Compatible Client  │
│  - MiniCPM5-2B (LiteRT-LM)    │           │  - Remote Config Driven   │
│  - 100% Private (Zero Egress) │           │  - Encrypted (TLS 1.3)    │
│  - Local Tool Bridge          │           │  - Local Token Metering   │
└───────────────┬───────────────┘           └─────────────┬─────────────┘
                │                                         │
        [Engine Unhealthy?]                               │
     (Memory Critical, Thermal,                           │
      Low RAM, Model Missing)                             │
                │                                         │
                ▼                                         │
┌───────────────────────────────┐                         │
│ User Privacy Consent Gate     │                         │
│ - Require Opt-In Confirmation ├─────────────────────────┘
│ - Display Disclosure Notice   │ (On Consent)
└───────────────────────────────┘
```

---

## 2. Runtime Execution Modes

Users configure their runtime preference at the first-run onboarding gate or within Settings:

| Mode | Behavior | Egress Guarantee |
|---|---|---|
| `on_device_only` | All turns execute strictly on the local hardware engine. If the model is not loaded, RAM is insufficient, or an error occurs, execution fails gracefully with an explicit refusal error. | **100% Zero-Egress**: Not a single byte ever leaves the physical device. |
| `cloud_only` | All requests route directly to the configured OpenAI-compatible remote gateway. | Encrypted TLS 1.3 transit with zero-retention cloud logging. |
| `auto_fallback` *(Default)* | The engine executes on-device whenever healthy. If local execution is unavailable due to memory pressure (`TRIM_MEMORY_RUNNING_CRITICAL`), thermal throttling (`THERMAL_CRITICAL`), or missing model artifacts, it seamlessly fails over to cloud fallback. | On-device by default; cloud egress only when local engine is unhealthy and user has granted privacy consent. |

---

## 3. OpenAI-Compatible Remote Client

The remote client (`OpenAiCompatibleClient`) conforms to the standard OpenAI Chat Completions API (`/v1/chat/completions`):

### 3.1 Dynamic Remote Configuration
In accordance with product security standards, **no API keys or remote URLs are hardcoded in the client application**. Credentials and gateway endpoints are retrieved dynamically via remote configuration:
- `baseUrl`: e.g. `https://api.vela.ai/v1` or custom provider URL.
- `apiKey`: Dynamically loaded from remote configuration or encrypted local storage (`expo-secure-store`).
- `defaultModel`: Remote default model identifier (e.g. `gpt-4o-mini`).
- `timeoutMs`: Request timeout ceiling (default: 15,000 ms) managed via `AbortController`.
- `maxRetries`: Bounded retry count (default: 2) with exponential backoff on retryable HTTP statuses (`429`, `500`, `502`, `503`, `504`).

### 3.2 Real-Time SSE Token Streaming
Supports Server-Sent Events (`stream: true` and `stream_options: { include_usage: true }`), dispatching incremental tokens to the UI via `onToken` callbacks while parsing structured completions.

### 3.3 Local Token Metering
Tracks client-side cumulative token usage across sessions without sending analytics to external trackers:
```typescript
interface TokenUsageMetrics {
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```
Exposes `getTokenUsageMetrics()` and `resetTokenMetrics()` for in-app transparency and usage monitoring.

---

## 4. Privacy Disclosure Copy & Consent Gate (Decision 4 & WF-01)

Transparency is paramount when falling back to remote servers. In adherence to **DECISIONS.md**:

### 4.1 Visual Pill / Badge Classification
Every turn executed through cloud fallback displays a prominent visual indicator:
- **Cloud Fallback Pill**: `Cloud Fallback`
- **On-Device Pill**: `On-Device (100% Private)`

### 4.2 Standardized Privacy Disclosure Copy (`PRIVACY_DISCLOSURE_COPY`)

```typescript
export const PRIVACY_DISCLOSURE_COPY = {
  title: 'Data Privacy & Cloud Fallback Notice',
  shortBadge: 'Cloud Fallback',
  bannerNotice:
    'Using secure cloud processing. Your request is encrypted in transit and never stored or used to train models.',
  modalExplanation:
    'Vela prioritizes on-device processing to keep your data 100% private. When local execution is unavailable due to memory constraints or hardware capabilities, requests can route via encrypted TLS 1.3 transport to our zero-log cloud fallback. Zero prompt retention, zero persistent logging, and zero training on your data.',
  onDeviceBadge: 'On-Device (100% Private)',
  onDeviceExplanation:
    'Processed completely on your phone. Zero bytes leave your device.',
};
```

### 4.3 Opt-In Consent Gate
When `auto_fallback` triggers for the first time, if the user has not explicitly consented to cloud routing (`userConsentedToCloud === false`), the router halts outbound network dispatch and returns:
```typescript
{
  requiresPrivacyConsent: true,
  executionMode: 'cloud_fallback',
  privacyNotice: {
    badge: 'Cloud Fallback',
    modalText: '...',
  }
}
```
The UI presents the confirmation modal before any user prompt bytes are transmitted over the network.

---

## 5. Verification & Contract Testing

Full contract and unit tests are implemented in `client/__tests__/cloudFallback.test.ts`:
- **OpenAI Compatibility**: Chat completions, SSE streaming, structured tool calls.
- **Resilience**: Timeout aborts and exponential backoff retry on 503/429.
- **Token Metering**: Prompt, completion, and total token accumulation.
- **Routing & Privacy**: Strict `on_device_only` refusal, `auto_fallback` health checks, visual fallback badges, and opt-in consent gating.

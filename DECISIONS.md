# Architectural & Product Decisions

This file tracks architectural and product tradeoff decisions with context, decision, and consequences.

## Index of Decisions

1. [2026-10-22: On-Device AI — Target Device Tier & 6 GB RAM Floor](#2026-10-22-on-device-ai--target-device-tier--6-gb-ram-floor)
2. [2026-10-22: On-Device AI — Model Download Source, Network Policy & Storage Gate](#2026-10-22-on-device-ai--model-download-source-network-policy--storage-gate)
3. [2026-10-22: On-Device AI — Low-RAM Runtime Degradation & Cloud Fallback](#2026-10-22-on-device-ai--low-ram-runtime-degradation--cloud-fallback)
4. [2026-10-22: On-Device AI — Cloud Fallback Policy & Privacy Disclosure](#2026-10-22-on-device-ai--cloud-fallback-policy--privacy-disclosure)
5. [2026-10-22: On-Device AI — Tool-Calling Scope & Security Consent Gates for v0](#2026-10-22-on-device-ai--tool-calling-scope--security-consent-gates-for-v0)
6. [2026-10-22: On-Device AI — Voice Stack Direction for v1 (Bridge Pipeline)](#2026-10-22-on-device-ai--voice-stack-direction-for-v1-bridge-pipeline)
7. [2026-10-22: On-Device AI — Voice Lane Architecture & Latency SLA (WF-03)](#2026-10-22-on-device-ai--voice-lane-architecture--latency-sla-wf-03)

---

### 2026-10-22: On-Device AI — Target Device Tier & 6 GB RAM Floor

- **Status**: Accepted
- **Context**: On-device MiniCPM5-2B inference requires sufficient RAM for Android OS (~2.5-3 GB), quantized model weights (~1.2-1.5 GB), and KV cache + runtime overhead (~0.5-1 GB).
- **Decision**: Minimum 6 GB RAM floor for local on-device execution. Devices with < 6 GB RAM are classified as `UNSUPPORTED` for local inference and automatically route to cloud gateway.
- **Consequences**: Protects against Android Low Memory Killer (LMK) process termination while covering mainstream mid-range devices (Pixel 6a+, Galaxy A54+, Nothing Phone).

### 2026-10-22: On-Device AI — Model Download Source, Network Policy & Storage Gate

- **Status**: Accepted
- **Context**: The quantized MiniCPM5-2B model artifact is ~1.2-1.5 GB in size.
- **Decision**: Model download URLs are retrieved dynamically from remote config/backend (never hardcoded in client). Downloads default to Wi-Fi only (with explicit user opt-in toggle for cellular). Pre-flight check requires >= 3 GB free storage before initiating download, and artifact SHA-256 checksum is verified before mounting.
- **Consequences**: Avoids accidental user data overages, prevents storage exhaustion crashes, and guarantees file integrity.

### 2026-10-22: On-Device AI — Low-RAM Runtime Degradation & Cloud Fallback

- **Status**: Accepted
- **Context**: Even on 6 GB+ devices, system memory pressure can fluctuate during active multitasking.
- **Decision**: Two-tier graceful degradation strategy:
  1. Under moderate memory warnings, prune KV cache context window from 4096 to 1024 tokens.
  2. If `TRIM_MEMORY_RUNNING_CRITICAL` is received from the OS, halt local inference and fallback to cloud execution with a user notification.
- **Consequences**: Keeps the application responsive without triggering OS process kills.

### 2026-10-22: On-Device AI — Cloud Fallback Policy & Privacy Disclosure

- **Status**: Accepted
- **Context**: When on-device execution cannot proceed (model not downloaded, low RAM, or unsupported hardware), requests may route to remote servers.
- **Decision**: Opt-in cloud fallback with prominent visual indication (a distinct "Cloud Fallback" badge/pill on message turns). Privacy copy explicitly guarantees encrypted transport, zero logging, and no training on user prompts.
- **Consequences**: High transparency for privacy-conscious users with graceful service continuity.

### 2026-10-22: On-Device AI — Tool-Calling Scope & Security Consent Gates for v0

- **Status**: Accepted
- **Context**: On-device AI needs tool capabilities to act as an assistant without introducing prompt injection or unintended device modification risks.
- **Decision**:
  - Scope for v0: Alarms, Calendar, Messages, Clipboard.
  - Read actions: Gated by standard Android runtime OS permissions.
  - Write/Mutating actions (set alarm, schedule event, draft/send message): Require an explicit user confirmation dialog (deny-by-default).
  - Hard cap of maximum 3 tool executions per turn.
- **Consequences**: Prevents unprompted modifications to user device data while enabling safe practical utility.

### 2026-10-22: On-Device AI — Voice Stack Direction for v1 (Bridge Pipeline)

- **Status**: Accepted
- **Context**: Adding voice interaction to Vela on mobile.
- **Decision**: Commit to the Bridge Pipeline for v1: Android SpeechRecognizer / local STT -> local MiniCPM5-2B -> Android TextToSpeech / system TTS. Target latency < 2s total turn time on mid-range phones. Defer tokenizer-free TTS (VoxCPM2) and omni full-duplex models (MiniCPM-o 4.5) to v2 flagship tiers.
- **Consequences**: Achieves reliable, low-latency, battery-conscious voice experience immediately without requiring flagship NPU hardware.

### 2026-10-22: On-Device AI — Voice Lane Architecture & Latency SLA (WF-03)

- **Status**: Accepted
- **Context**: Rigorous evaluation of the three voice lanes (Bridge, Polish/VoxCPM2, Omni/MiniCPM-o 4.5) from WF-08 against the 6 GB RAM floor constraint and latency SLA.
- **Decision**:
  1. **v1 Architecture**: Commit to **Lane 1 (Bridge Pipeline)** completely on-device.
     - STT: Android `SpeechRecognizer` (online/offline system default) or offline `vela-whisper` tiny/base JNI.
     - LLM: On-device MiniCPM5-2B (`.litertlm` INT4 via LiteRT-LM).
     - TTS: Android system `TextToSpeech` or local embedded Piper.
  2. **Latency Budget SLA**:
     - STT Latency: <= 250 ms.
     - LLM TTFT (Time-to-First-Token) & First Chunk: <= 350 ms (first clause chunk at ~8 tokens).
     - TTS Synthesis Start: <= 200 ms.
     - Total Turn Latency: <= 1200 ms (strict target well within the 2000 ms budget).
     - Active RAM: <= 2.1 GB (fits comfortably on 6 GB RAM floor with >1 GB OS/system headroom).
  3. **Flagship / v2 Direction**:
     - Roadmap **Lane 3 (MiniCPM-o 4.5)** via OpenBMB Cloud API (WebSocket 16 kHz PCM streaming) or local on-device inference on flagship devices with >= 16 GB unified RAM.
  4. **Cloud Privacy Disclosure Copy**:
     - Any remote audio processing requires explicit opt-in with user consent copy:
       `"Voice audio will be securely streamed to OpenBMB Cloud API solely for real-time transcription and generation. Audio is processed transiently in memory, never logged, and never used for model training."`
  5. **Child Tickets Groomed for Phase 3**:
     - WF-V01: Local STT integration (`vela-whisper` JNI & Android SpeechRecognizer).
     - WF-V02: Streaming token-to-sentence chunking with barge-in cancellation (`ai-voice-agent` port).
     - WF-V03: System TTS integration & Voice UI waveform visualizer (`vela-voice-ui`).
     - WF-V04: Opt-in MiniCPM-o 4.5 Cloud API WebSocket client with privacy banner.
- **Consequences**: Guarantees snappy, battery-efficient on-device voice turns without risking LMK process kills on 6 GB devices while establishing a clear upgrade path for flagship conversational omni-modality.

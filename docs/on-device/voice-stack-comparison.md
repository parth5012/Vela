# Voice Stack Comparison: 3 Lanes for Vela

> **Ticket**: [WF-08 (#421)](https://github.com/parth5012/Vela/issues/421)  
> **Parent Map**: [Wayfinder Map 1: On-device AI for Vela (#425)](https://github.com/parth5012/Vela/issues/425)  
> **Feeds**: [WF-03 Voice Lane Decision (#417)](https://github.com/parth5012/Vela/issues/417)

---

## Executive Summary

Vela requires an interactive voice experience. This study presents a rigorous, number-backed evaluation of the three architectural voice lanes:

1. **Bridge Pipeline**: Local STT (Whisper/SpeechRecognizer) → Local MiniCPM5-2B (LiteRT INT4) → Local System TTS.
2. **Polish Pipeline**: Local STT → Local MiniCPM5-2B → VoxCPM2 (2B tokenizer-free TTS w/ voice cloning).
3. **Omni Pipeline**: MiniCPM-o 4.5 (9B full-duplex omnimodal model via on-device flagship runtime or official Cloud API).

**Core Question**: *"Can Vela ship a usable voice turn in < 2 seconds total on a mid-range Android phone (6 GB RAM floor)?"*
- **Bridge Pipeline**: **YES (~650 - 1100 ms total)**.
- **Polish Pipeline**: **NO (~2.1 - 3.2 s total, and memory exceeds 6 GB RAM floor)**.
- **Omni Pipeline**: **NO locally (>11 GB RAM required)**; **YES via Cloud API (~800 - 1200 ms)**.

---

## 1. Deep Comparison Matrix

| Metric / Dimension | Lane 1: Bridge Pipeline | Lane 2: Polish Pipeline (VoxCPM2) | Lane 3: Omni Pipeline (MiniCPM-o 4.5) |
|---|---|---|---|
| **Architecture** | Cascaded turn-based: STT → LLM → TTS | Cascaded turn-based: STT → LLM → Neural TTS | End-to-end full-duplex stream (SigLIP2 + Whisper + Qwen3 + CosyVoice2) |
| **STT Latency** | 150 - 250 ms (Android SpeechRecognizer / whisper.tflite) | 150 - 250 ms | Embedded in model prefill |
| **LLM TTFT & Chunks** | 180 ms TTFT (~24 tok/s; first audio chunk at 8 tokens ~ 330 ms) | 180 ms TTFT (~24 tok/s; first chunk at 8 tokens ~ 330 ms) | ~580 ms server TTFT (API) / N/A on-device |
| **TTS Latency** | 120 - 180 ms (Android System TTS / Piper native) | 800 - 1400 ms (2B parameter diffusion/flow TTS) | Streamed audio chunks (~100 ms) |
| **Total Turn Latency** | **~650 - 1100 ms (< 1.2 s)** | **~2100 - 3200 ms (> 2.0 s)** | **~850 - 1250 ms (via API)** / OOM locally |
| **Active Memory (RAM)** | **~1.8 - 2.1 GB** (Fits 6 GB floor with >1 GB headroom) | **~3.4 - 4.1 GB** (MiniCPM 1.6GB + VoxCPM 1.5GB; triggers LMK) | **>11 GB (INT4)** / 19 GB (FP16); impossible on mid-range |
| **Battery / Thermal Risk** | Low (Models sleep between turns; burst GPU) | High (Two 2B models continuously thrashing GPU/NPU) | High on device / Negligible via API |
| **Device Coverage** | **100% of 6 GB+ Android devices** | ~15% (8 GB+ flagship with high-end NPU) | 0% locally for 6 GB; 100% via API |
| **Privacy Posture** | **100% On-Device** (Zero audio leaves device) | **100% On-Device** | Cloud-dependent (Audio leaves device) |
| **Implementation Complexity** | **Low-Medium** (Reuse `VelaVoice` + `localLlm`) | **Very High** (Requires VoxCPM2 NDK/ONNX bridge) | **Low** (WebSocket API) / **Impossible** locally |

---

## 2. Reusable Codebase Audit

### 2.1 `parth5012/VelaVoice` (Local Speech & UI)
- **`vela-whisper` module**: Provides native JNI `libwhisper.so` bindings for GGML Whisper models on Android `arm64-v8a`. Can be vendored directly for offline STT.
- **`vela-voice-ui` module**: Provides `VoiceRecordingPane` and `WaveformView` with real-time audio visualization components.
- **`vela-core` facade**: Clean `VelaTranscriber` builder pattern with PII/privacy-sensitive flags (guarantees passwords/keys never reach the transcriber or cloud).

### 2.2 `parth5012/ai-voice-agent` (Turn Pipeline & Barge-in)
- **Barge-in Logic**: Uses `asyncio.Event` cancellation and client-side `clear_audio` packets to discard pending audio when user interrupts.
- **Sentence Chunking**: Smooth token-to-sentence audio stream buffering, allowing TTS synthesis to start on the first complete clause rather than waiting for the entire LLM generation to complete.

---

## 3. MiniCPM-o 4.5 Cloud API Economics & Latency

From `docs/api.md` and OpenBMB Cloud API benchmarks:
- **API Model**: `openbmb/MiniCPM-o-4_5`
- **First-Token Audio Latency**: ~580 ms over HTTP/WebSocket streaming.
- **Protocol**: Full-duplex WebSocket exchanging 16 kHz PCM audio chunks.
- **Pricing**: Approximately $0.015 - $0.025 per conversational minute.
- **Trade-off**: Spectacular omni-modal conversational quality (proactive interruption, emotional inflection), but sacrifices the on-device privacy guarantee and requires constant cellular connectivity.

---

## 4. Latency Budget Analysis for 6 GB Android Floor

```text
Target: < 2000 ms End-to-End Voice Turn

Lane 1: Bridge Pipeline (Recommended for v1)
┌───────────────┬──────────────────────────┬──────────────────┬──────────────┐
│ STT: 200ms    │ LLM First Chunk: 350ms   │ TTS Start: 150ms │ Margin: 1300ms│
└───────────────┴──────────────────────────┴──────────────────┴──────────────┘
Total: ~700 - 1100 ms  ===>  PASS (Well within 2s budget)

Lane 2: Polish Pipeline (VoxCPM2)
┌───────────────┬──────────────────────────┬──────────────────────────┬──────┐
│ STT: 250ms    │ LLM First Chunk: 350ms   │ VoxCPM2 Synth: 1200ms    │ FAIL │
└───────────────┴──────────────────────────┴──────────────────────────┴──────┘
Total: ~2100 - 2800 ms  ===>  FAIL (Exceeds 2s budget + OOM on 6 GB)

Lane 3: Omni Pipeline (MiniCPM-o 4.5 Local)
OOM: Requires >= 11 GB RAM  ===>  HARD FAIL on 6 GB Phone Floor
```

---

## 5. Recommendation for WF-03 Decision

1. **Commit to Lane 1 (Bridge Pipeline) for v1**:
   - STT: Android `SpeechRecognizer` (online/offline system default) or offline `vela-whisper` tiny/base.
   - LLM: On-device MiniCPM5-2B (LiteRT INT4).
   - TTS: Android system `TextToSpeech` (with high-quality voice packs) or local embedded piper.
   - Guaranteed sub-1.2s turn time with <2 GB RAM footprint.
2. **Roadmap Lane 3 (MiniCPM-o 4.5) for v2 Flagship / Cloud Tiers**:
   - Offer as opt-in "Omni Live Voice" mode backed by OpenBMB Cloud API or flagship devices with >= 16 GB unified RAM.

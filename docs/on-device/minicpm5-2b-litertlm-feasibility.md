# LiteRT-LM Feasibility for MiniCPM5-2B on Android

> **Ticket**: [WF-04 (#422)](https://github.com/parth5012/Vela/issues/422)  
> **Parent Map**: [Wayfinder Map 1: On-device AI for Vela (#425)](https://github.com/parth5012/Vela/issues/425)  
> **Feeds**: [WF-02 Prototype Spike (#423)](https://github.com/parth5012/Vela/issues/423)

---

## Executive Summary

MiniCPM5-2B (OpenBMB, released late 2026, Apache-2.0) is a dense 2.5B-parameter hybrid-reasoning model (42 layers, hidden 2048, GQA 16:2, 130k vocabulary) built on the standard `LlamaForCausalLM` architecture. 

This feasibility study evaluates running MiniCPM5-2B locally on Android using Google's **LiteRT-LM** (`.litertlm` format) compared to a **llama.cpp / GGUF** fallback.

**Verdict: FEASIBLE (GO for WF-02 Prototype Spike)**.  
The **1.55 GB INT4 `.litertlm` artifact** (`MiniCPM5-2B_int4.litertlm`) is publicly available in ungated repositories, natively fits the **6 GB RAM floor**, and runs efficiently on mobile GPUs via OpenCL.

---

## 1. `.litertlm` Artifact Availability & Conversion Path

### 1.1 Available Pre-converted Bundles

The official and community repositories provide ungated `.litertlm` bundles without API tokens or license gating:

| Repository | Artifact File | Quantization Recipe | Size | Target / Performance |
|---|---|---|---|---|
| `litert-community/MiniCPM5-2B` | `MiniCPM5-2B_int4.litertlm` | INT4 blockwise-32 + OCTAV on linears, INT8 embedding | **1.55 GB** | **Primary Android Phone target**. Fastest GPU decode (~93 tok/s on flagship GPU, ~20-30 tok/s on mid-range). |
| `litert-community/MiniCPM5-2B` | `MiniCPM5-2B_int8.litertlm` | INT8 dynamic channelwise on linears + embedding (`dynamic_wi8_afp32`) | **2.55 GB** | High-precision reasoning; higher memory footprint. |
| `mlboydaisuke/MiniCPM5-2B-LiteRT` | `MiniCPM5-2B_int4.litertlm` | INT4 blockwise-32 + OCTAV, updated Jinja chat template | **1.55 GB** | Verbatim ChatML + declared `thought` channel and tool definitions. |

### 1.2 Custom Conversion Recipe (`docs/deployment/litert.md`)

If custom quantization or metadata tuning is required, OpenBMB documents the official conversion path:

```bash
# Tooling required: litert-torch, litert-converter, ai-edge-quantizer
litert-torch export_hf \
  --model_id="openbmb/MiniCPM5-2B" \
  --quantization_recipe="dynamic_wi8_afp32" \
  --use_bool_mask=True \
  --apply_gpu_composites=True \
  --cache_length=32771 \
  --experimental_lightweight_conversion \
  --output_dir="./minicpm5_litert"
```

The resulting `.litertlm` file bundles:
- `TF_LITE_PREFILL_DECODE` (quantized linear graphs + GPU composites)
- `TOKENIZER_MODEL` (byte-level BPE `tokenizer.json`)
- `METADATA` (`LlmMetadataProto` specifying start/stop tokens `<|im_end|>`, max context 4096, and `thought` channel tags).

---

## 2. Quantized Variants & RAM Budget vs 6 GB Floor

### 2.1 Memory Footprint Analysis

| Model Variant | File Size | Runtime Base RAM | KV Cache (1024 tok) | KV Cache (4096 tok) | Peak Active RAM | Compatibility (6 GB Floor) |
|---|---|---|---|---|---|---|
| **INT4 (`MiniCPM5-2B_int4.litertlm`)** | **1.55 GB** | **~1.65 GB** | **~180 MB** | **~480 MB** | **~2.2 - 2.5 GB** | **Supported (Recommended)** |
| **INT8 (`MiniCPM5-2B_int8.litertlm`)** | 2.55 GB | ~2.75 GB | ~180 MB | ~480 MB | ~3.3 - 3.8 GB | Marginal (High LMK pressure) |

### 2.2 Sizing on 6 GB Devices

- Android OS and critical system background services typically occupy 2.5 GB to 3.2 GB of RAM.
- Free user-space memory on a quiet 6 GB device is approximately 2.8 GB to 3.5 GB.
- **INT4 (1.55 GB)** leaves ~1.0 - 1.2 GB of breathing room, ensuring the Android Low Memory Killer (LMK) does not terminate the Vela inference service.
- **INT8 (2.55 GB)** risks immediate LMK termination if the user switches apps or if the camera/launcher requests memory.
- **Conclusion**: The **INT4** artifact is the hard requirement for the 6 GB RAM floor.

---

## 3. Runtime Comparison: LiteRT-LM vs llama.cpp (GGUF)

| Dimension | LiteRT-LM (`.litertlm`) | llama.cpp / `llama.rn` (GGUF) |
|---|---|---|
| **Android Integration** | Google official AAR: `com.google.ai.edge.litertlm:litertlm-android` or C API via JNI/FFI | Third-party React Native native module (`llama.rn`) or custom C++ JNI build |
| **GPU Acceleration** | Native OpenCL / Vulkan shader delegates compiled into runtime | Vulkan / OpenCL backend compiled into `libllama.so` |
| **Tool Calling / Jinja** | Native ChatML parsing with declared `tools` block in metadata | Handled via GBNF grammars or prompt formatting |
| **Thinking / Reasoning** | Declared `thought` channel (`<thought> ... </thought>`) split natively | Regex / string stream post-processing |
| **Stability Risk** | GPU driver shader compilation crashes on older Mali GPUs (mitigated by `liteRtCrashFlag.ts`) | Memory fragmentation and NDK ABI build synchronization |
| **Effort to Spike (WF-02)** | **Low** (Pre-built AAR / MediaPipe / LiteRT JNI bridge) | **Medium-High** (Requires NDK C++ toolchain integration in client) |

**Recommendation**: Pursue **LiteRT-LM** as primary path for WF-02. If OpenCL GPU initialisation fails on the test device, fallback to CPU mode first before rerouting to llama.cpp GGUF.

---

## 4. Licensing & Attribution Surface

- **MiniCPM5-2B Weights & Architecture**: OpenBMB releases the checkpoint under the **Apache-2.0** license.
- **LiteRT & LiteRT-LM**: Developed by Google under the **Apache-2.0** license.
- **Distribution Requirements**:
  1. No commercial royalty obligations.
  2. Maintain Apache-2.0 license notice and OpenBMB attribution in `client/modules/engine/THIRD_PARTY_NOTICES.md` and the app's About / Legal screen.
  3. No patent encumbrances or proprietary gating constraints.

---

## 5. Minimum SDK, ABI & Hardware Delegate Maturity

- **Minimum SDK**: **Android API 24** (Android 7.0 Nougat).
  - Recommended minimum for GPU acceleration stability: **Android API 28+** (Android 9.0 Pie) due to updated OpenCL ICD loaders.
- **Target ABI**: **`arm64-v8a` only**.
  - `armeabi-v7a` (32-bit) is strictly unsupported due to 4 GB address space limits and inability to map >1.5 GB memory segments.
  - `x86_64` supported for emulator debugging (CPU only).
- **Delegates**:
  - **GPU (OpenCL)**: Mature and production-ready on Qualcomm Adreno 6xx/7xx and ARM Mali-Gxx.
  - **NPU (QNN / MediaTek Neuropilot)**: Hardware-specific delegates exist in LiteRT 2.x, but driver variance is high. GPU is the primary cross-device acceleration target for v0/v1.

---

## 6. Cold Start Plan for WF-02 (Prototype Spike)

1. **Model Source**: Download `MiniCPM5-2B_int4.litertlm` (1.55 GB) from `https://huggingface.co/litert-community/MiniCPM5-2B/resolve/main/MiniCPM5-2B_int4.litertlm` into the device's app-internal cache directory.
2. **Spike Module**: Create a lightweight evaluation screen / test hook in `client/` that loads the model via the LiteRT-LM engine.
3. **Execution Gate**: Run a standardized prompt (`"Explain gravity in two sentences."`), capturing:
   - Initial load time (ms)
   - Time to first token (TTFT in ms)
   - Generation throughput (tokens/s)
   - Peak RSS / PSS memory consumption
4. **GO/NO-GO Criteria**:
   - **GO**: Generation throughput >= 10 tok/s on GPU, peak memory <= 2.8 GB, zero process aborts.
   - **NO-GO**: Hard SIGABRT or driver crashes unresolvable via CPU fallback → reroute to llama.cpp GGUF.

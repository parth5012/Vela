# Comprehensive Research Document: Device Capability Detection on Android & RAM Auto-Configuration

## 1. Executive Summary & Context
In Map #612 and Grilling #613, the team aligned on creating an automated device capability detection and configuration system for on-device local AI inference in Vela:
- **Scope**: Unified **Device Capability Card** and **Recommendation Banner** with "Accept" and "Customize" actions.
- **User Confirmation**: Recommended settings require explicit Owner consent; the app never silently mutates model parameters without confirmation.
- **Dual UI Placement**: Deployed in both **Local AI Settings** (`client/app/settings/local-ai.tsx`) and **Setup/Onboarding** (`client/app/setup.tsx`).
- **4-Tier Memory Classification**: Entry (≤4 GB), Mid-Tier (4–6 GB), Performance (6–8 GB), and Flagship (>8 GB).
- **Per-Model Overrides**: Persist custom context size, max output tokens, and GPU backend preferences per model in `useConfigStore`.
- **Fail-Safe Fallback**: If RAM is unreadable, show "RAM Unknown", do not guess or auto-apply, and allow manual selection with OOM warning guards.

---

## 2. Android RAM Detection Mechanisms in React Native / Expo

### 2.1 Native Android API & Underlying Kernel Mechanics
1. **`ActivityManager.MemoryInfo` (`ActivityManager.getMemoryInfo()`)**:
   - The canonical Android framework API.
   - Populates `ActivityManager.MemoryInfo`:
     - `totalMem`: Total physical memory accessible by the Linux kernel in bytes (`long`).
     - `availMem`: Available memory before the system starts aggressively terminating background processes.
     - `threshold`: Low-memory threshold below which the Low Memory Killer (LMK) initiates aggressive process kills.
     - `lowMemory`: Boolean flag indicating if the system is currently under memory pressure.
   - Internally reads `/proc/meminfo` or executes the `sysinfo()` system call via Bionic libc.

2. **`/proc/meminfo` (`MemTotal`) & Hardware Carve-Outs**:
   - `MemTotal` reports total usable RAM in kilobytes.
   - **Crucial Distinction**: `MemTotal` (and `MemoryInfo.totalMem`) does **NOT** equal the retail advertised RAM on the device's box. The kernel-visible total excludes hardware-reserved memory carved out before kernel boot:
     - Baseband / cellular modem reserved RAM.
     - Dedicated Camera ISP (Image Signal Processor) buffers.
     - ARM TrustZone / Secure World memory carve-outs (TEE).
     - GPU hardware framebuffer / display controller reserved memory.
   - **Empirical Discrepancy Table**:
     - **4 GB Advertised**: Typical kernel `totalMem` is 3,650 MB – 3,850 MB (~3.6–3.8 GB) with ~250–450 MB carve-out.
     - **6 GB Advertised**: Typical kernel `totalMem` is 5,450 MB – 5,750 MB (~5.3–5.6 GB) with ~400–700 MB carve-out.
     - **8 GB Advertised**: Typical kernel `totalMem` is 7,400 MB – 7,700 MB (~7.2–7.5 GB) with ~500–800 MB carve-out.
     - **12 GB Advertised**: Typical kernel `totalMem` is 11,200 MB – 11,600 MB (~11.0–11.3 GB) with ~700–1,100 MB carve-out.
   - **Design Implication for Tier Classification**: Tier boundary logic must account for this carve-out. A strict mathematical check `ramBytes >= 4 * 1024 * 1024 * 1024` on a nominal 4 GB phone will evaluate to ~3.7 GB and classify it as "Entry (≤4 GB)", which is the safe and intended behavior. For a nominal 6 GB device reporting 5.5 GB, classifying it as Mid-Tier (4–6 GB) rather than Entry is correct.

3. **Total Physical Memory vs Dynamic Available Memory**:
   - `totalMem` is static across the lifetime of the boot session.
   - `availMem` fluctuates constantly as applications launch, background, or allocate memory.
   - **Rule**: Model recommendation, tier badging, and capability classification **must strictly use total physical RAM (`totalMem`)**. Using instantaneous available RAM would cause erratic tier downgrades, flickering UI badges, and inconsistent recommendations whenever background apps are active. Dynamic memory monitoring is reserved exclusively for pre-inference OOM safety guards.

### 2.2 React Native & Expo Implementation (`expo-device`)
In Expo/React Native, `expo-device` exposes `Device.totalMemory`:
- **Implementation**: Written in Kotlin (`DeviceModule.kt`), it calls `activityManager.getMemoryInfo(memInfo)` and exposes `memInfo.totalMem` as a synchronous exported property.
- **Vela Implementation in `client/utils/ramDetection.ts`**:
  ```typescript
  export async function detectRamBytes(options?: { allowEmulator?: boolean }): Promise<number> {
    if (Platform.OS === 'web') {
      return options?.allowEmulator ? 6 * 1024 * 1024 * 1024 : 0;
    }
    try {
      const memory = Device.totalMemory;
      if (memory && memory > 0) return memory;
    } catch (err) {
      console.warn('[ramDetection] Failed to read totalMemory from Device api:', err);
    }
    return options?.allowEmulator ? 6 * 1024 * 1024 * 1024 : 0;
  }
  ```

### 2.3 Web, Desktop, & Emulator Nuances
1. **Web (`Platform.OS === 'web'`)**:
   - Browser environments do not have direct access to physical memory. `navigator.deviceMemory` exists in Chromium but reports coarse, quantized buckets (0.25, 0.5, 1, 2, 4, 8 GB) to mitigate browser fingerprinting, and is unavailable on Firefox/Safari.
   - In Vela, when running on web or during automated Playwright tests, `allowEmulator: true` supplies a simulated 6 GB value (`6 * 1024 * 1024 * 1024`) so UI testing can proceed.
2. **Production Native Builds**:
   - In production native Android builds (`Platform.OS === 'android'` and `!__DEV__`), simulation is disabled. If `Device.totalMemory` returns null, 0, or throws, `detectRamBytes` returns `0`.
3. **Android Emulators**:
   - In Android Studio AVDs, `totalMem` reflects the RAM allocated to the virtual machine in `config.ini` (typically 1.5 GB to 4 GB by default unless configured for 6–8 GB).

### 2.4 Fail-Safe Handling & The "RAM Unknown" State Machine
When `detectRamBytes()` fails to read physical RAM (returns `0`, negative, `NaN`, or non-finite):
- **Never Guess or Fabricate**: Do not assume a fallback 6 GB or 8 GB tier in production.
- **Fail-Closed Gate**: In `client/utils/modelGate.ts`, `evaluateDeviceCapabilities()` marks `ramBytes <= 0` as `UNSUPPORTED` with reason `"Unable to determine device RAM: total memory is unavailable or unreadable"`.
- **UI State ("RAM Unknown")**:
  - The Capability Card displays:
    - Memory: `RAM Unknown` (subtext: *"Total device memory could not be read"*).
    - Tier Badge: `Unknown Tier` (neutral Slate `#94a3b8`).
  - Recommendation Banner: Suppressed or displays an informational notice: *"Auto-configuration unavailable. Pick a model manually below."*
  - Manual Selection: The Owner is permitted to select any downloaded model, but selecting a model with footprint > 1 GB triggers a confirmation dialog warning of potential OOM crashes.

---

## 3. GPU/SoC Hardware Profiling & Inference Guards

On mobile SoCs (System-on-Chip), CPU, GPU, and NPU share the same physical DRAM pool via Unified Memory Architecture (UMA). There is no dedicated discrete VRAM.

### 3.1 Chipset Classification (`classifyGpuVendor`)
Vela identifies GPU chipsets using native Android hardware properties via `StableDiffusionModule.kt` (`getGpuInfo()`):
- `Build.HARDWARE` (e.g. `qcom`, `exynos`, `mt6893`)
- `Build.BOARD`
- `Build.SOC_MODEL` (Android 12+ / API 31+, e.g. `SM8450`, `GS101`, `Tensor`)
- OpenGL ES configuration info (`ActivityManager.getDeviceConfigurationInfo().glEsVersion`)

In `client/utils/ramDetection.ts`, `classifyGpuVendor(hardware, socModel)` classifies hardware into 5 distinct categories:
```typescript
export type GpuVendor = 'adreno' | 'mali' | 'xclipse' | 'tensor' | 'unknown';
export type GpuBackend = 'opencl' | 'vulkan' | 'cpu';

export const GPU_BACKEND_TABLE: Record<GpuVendor, GpuBackend> = {
  adreno: 'opencl',    // Qualcomm Adreno: OpenCL matrix kernels are mature & fast
  mali: 'vulkan',      // ARM Mali: OpenCL drivers often broken; Vulkan compute is reliable
  xclipse: 'vulkan',   // Samsung/AMD RDNA: Vulkan compute leverages RDNA architecture
  tensor: 'cpu',       // Google Tensor: Driver instabilities require CPU fallback
  unknown: 'cpu',      // Unknown/Unrecognized: Safe CPU execution
};
```

#### Detailed Vendor Classification Rules
1. **Google Tensor** (`tensor`): Match `tensor`, `zuma`, `gs[1-4]\w*`, `gs[1-4]01` (Pixel 6 through Pixel 9).
2. **Qualcomm Adreno** (`adreno`): Match `adreno`, `qcom`, `qualcomm`, `snapdragon`, `msm\w*`, `sdm\w*`, `sm\d{4}\w*` (Snapdragon 8 Gen 1/2/3, Snapdragon 7/6/4 series).
3. **Samsung Xclipse** (`xclipse`): Match `xclipse`, `rdna`, `s5e9925` (Exynos 2200), `s5e9945` (Exynos 2400), `s5e8845` (Exynos 1480). AMD RDNA GPU IP.
4. **ARM Mali** (`mali`): Match `mali`, `exynos`, `kirin`, `hisilicon`, `mediatek`, `dimensity`, `helio`, `mt\d+\w*`, `mtk\w*`.
5. **Unknown** (`unknown`): Any unrecognized or empty identifier fails safe to `unknown`.

### 3.2 UMA VRAM Cap Calculations (`getVramCapBytes`)
Because mobile GPUs share unified memory with the operating system and applications, allocating excessive GPU buffer memory leads to kernel GPU resets, driver deadlocks, or immediate SIGKILL terminations.

Vela enforces an empirical VRAM cap formula (`client/utils/ramDetection.ts`):
$$\text{VRAM\_CAP} = \text{clamp}(\text{RAM} \times 0.22, 0.75\,\text{GB}, 1.75\,\text{GB})$$
- **VRAM Cap Ratio**: `0.22` (22% of total physical RAM).
- **Minimum Floor**: `0.75 GB` (786,432 KB) — Ensures baseline models can attempt GPU acceleration on budget devices.
- **Maximum Ceiling**: `1.75 GB` (1,835,008 KB) — Prevents GPU buffer runaway even on 12–16 GB devices, protecting display compositor memory.

### 3.3 Hardware-Specific Stability Guards
1. **Google Tensor Gemma Q4_K_M Stability Guard**: On Google Tensor chipsets (Pixel 6–9), running Gemma models quantized with `Q4_K_M` under Vulkan or OpenCL triggers known shader compiler kernel panics and SIGSEGV faults during intermediate matrix compilation. `isTensorGuarded(modelName)` detects Gemma + Q4_K_M combinations and forces `getGpuBackendPreference` to return `cpu`.
2. **VRAM Cap Exceedance Guard (`shouldForceCpu`)**: Before launching a model on GPU, `shouldForceCpu()` evaluates estimated peak memory against `vramCapBytes`. If estimated peak RAM exceeds the VRAM cap, the backend automatically falls back to `cpu`.
3. **LiteRT GPU Crash Flag Guard (`liteRtCrashFlag.ts`)**: If a previous GPU initialization crashed during model load, a persistent marker is written to storage (`isGpuCrashFlagSet()`). The app runs in CPU-safe fallback mode on next launch, alerting the Owner and requiring manual dismissal or retry.

---

## 4. Model Recommendation & Sizing Engine

### 4.1 Memory Footprint Multipliers by Format
A model's raw file size on disk does not represent its RAM consumption during inference. The engine must allocate:
- Model weight tensors in memory.
- Intermediate activation tensors and workspace buffers.
- Compute graph structure and dequantization scratchpads.

Vela establishes empirical multipliers based on model format (`client/utils/ramDetection.ts`):
- **`.cact` (Needle Engine)**: **1.20x** (static memory graph; minimal runtime buffer overhead).
- **`.gguf` (llama.cpp / `llama.rn`)**: **1.35x** (dynamic tensor scratchpads, dequant buffers, graph metadata).
- **`.task` (MediaPipe / LiteRT)**: **1.60x** (flatbuffer parsing overhead, activation tensor buffers).

### 4.2 KV Cache Sizing per Token
The Key-Value (KV) cache grows linearly with context length. For 1B–2B transformer models with 16–24 layers and multi-head attention:
$$\text{KV\_CACHE\_BYTES\_PER\_TOKEN} = 512\,\text{bytes}\quad (\approx 0.5\,\text{KB per token})$$
- At **1,024 context**: $1,024 \times 512 = 512\,\text{KB}$ (~0.5 MB).
- At **2,048 context**: $2,048 \times 512 = 1,024\,\text{KB}$ (~1.0 MB).
- At **4,096 context**: $4,096 \times 512 = 2,048\,\text{KB}$ (~2.0 MB).
- At **8,192 context**: $8,192 \times 512 = 4,096\,\text{KB}$ (~4.0 MB).

### 4.3 Estimated Peak RAM Formula
$$\text{PeakRAM} = (\text{modelSizeBytes} \times \text{FORMAT\_RAM\_MULTIPLIERS}[\text{format}]) + (\text{contextSize} \times 512)$$

### 4.4 Dynamic Ratio Classification
When evaluating any model (preset or custom) against device memory:
$$\text{Ratio} = \frac{\text{PeakRAM}}{\text{DeviceRAM}}$$
- **Recommended** ($\text{Ratio} < 0.50$): Consumes less than 50% of device RAM. Low risk of OOM, leaves ample headroom for Android system services.
- **Borderline** ($0.50 \le \text{Ratio} \le 0.75$): Consumes 50% to 75% of device RAM. Operable, but background apps may be evicted by the LMK.
- **Unsupported** ($\text{Ratio} > 0.75$): Exceeds 75% of device RAM. High OOM termination risk; blocked from auto-recommendation.
- **Fail-Safe**: If `DeviceRAM <= 0`, status resolves strictly to `unsupported`.

### 4.5 4-Tier Memory Classification Architecture
Aligned with ticket #613 grilling decisions, devices are classified into four explicit hardware tiers:
1. **Entry (≤4 GB)**:
   - Target RAM: `<= 4 GB` (realistically 3.6 - 4.0 GB).
   - Recommended Model: `SmolLM 135M` (~0.11 GB).
   - Preset: Context 1024 tokens, Max Tokens 256 tokens.
   - Borderline: `Qwen2.5 0.5B` (~0.49 GB).
   - Unsupported: 1B+ models.
2. **Mid-Tier (4–6 GB)**:
   - Target RAM: `4 GB < RAM <= 6 GB` (realistically 4.1 - 6.0 GB).
   - Recommended Model: `Qwen2.5 0.5B` (~0.49 GB) or `Llama 3.2 1B (GGUF)` (~0.81 GB).
   - Preset: `Qwen2.5 0.5B`, Context 2048 tokens, Max Tokens 512 tokens.
   - Borderline: `TinyLlama 1.1B`, `Qwen2.5 1.5B (GGUF)`, `DeepSeek-R1 1.5B (GGUF)`.
   - Unsupported: `Phi-4 Mini (GGUF)` (~2.5 GB).
3. **Performance (6–8 GB)**:
   - Target RAM: `6 GB < RAM <= 8 GB` (realistically 6.1 - 8.0 GB).
   - Recommended Model: `Qwen2.5 1.5B (GGUF)` (~1.06 GB).
   - Preset: `Qwen2.5 1.5B (GGUF)`, Context 4096 tokens, Max Tokens 1024 tokens.
   - Recommended: All models <= 1.5B (Qwen2.5 1.5B, DeepSeek-R1 1.5B, Liquid LFM 1.7B, Phi-4 Mini).
4. **Flagship (>8 GB)**:
   - Target RAM: `> 8 GB` (12 GB, 16 GB, 24 GB).
   - Recommended Model: `Qwen2.5 1.5B (GGUF)`.
   - Preset: `Qwen2.5 1.5B (GGUF)`, Context 8192 tokens, Max Tokens 4096 tokens.

#### Detailed Shipped Models Tier Matrix (`LOCAL_MODELS`)
| Model Name | Format | Disk Size | Entry (≤4 GB) | Mid-Tier (4–6 GB) | Performance (6–8 GB) | Flagship (>8 GB) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Needle-3 (20-layer)** | `cact` | ~0.035 GB | **Recommended** | **Recommended** | **Recommended** | **Recommended** |
| **SmolLM 135M** | `gguf` | ~0.11 GB | **Recommended** *(Preset)* | **Recommended** | **Recommended** | **Recommended** |
| **Qwen2.5 0.5B** | `gguf` | ~0.49 GB | Borderline | **Recommended** *(Preset)* | **Recommended** | **Recommended** |
| **TinyLlama 1.1B** | `gguf` | ~0.67 GB | Unsupported | Borderline | **Recommended** | **Recommended** |
| **Llama 3.2 1B (GGUF)** | `gguf` | ~0.81 GB | Unsupported | **Recommended** | **Recommended** | **Recommended** |
| **Qwen2.5 1.5B (GGUF)** | `gguf` | ~1.06 GB | Unsupported | Borderline | **Recommended** *(Preset)* | **Recommended** *(Preset)* |
| **DeepSeek-R1 1.5B (GGUF)** | `gguf` | ~1.06 GB | Unsupported | Borderline | **Recommended** | **Recommended** |
| **Liquid LFM 1.7B (GGUF)** | `gguf` | ~1.15 GB | Unsupported | Borderline | **Recommended** | **Recommended** |
| **Phi-4 Mini (GGUF)** | `gguf` | ~2.50 GB | Unsupported | Unsupported | **Recommended** | **Recommended** |

*Needle Note*: Needle-3 evaluates to `recommended` across all tiers due to its tiny 35 MB size, but chat presets select general LLMs (SmolLM, Qwen2.5) because Needle is specialized for device automation tools.

---

## 5. UI/UX Architecture & Interaction Design

### 5.1 Device Capability Card Component
- **Header**: Title "Hardware Capabilities" with right-aligned **Device Tier Badge**.
- **Tier Badges**:
  - `Entry (≤4 GB)`: Background `rgba(245, 158, 11, 0.15)`, Border `#f59e0b`, Text `#f59e0b` (Amber).
  - `Mid-Tier (4–6 GB)`: Background `rgba(59, 130, 246, 0.15)`, Border `#3b82f6`, Text `#60a5fa` (Blue).
  - `Performance (6–8 GB)`: Background `rgba(99, 102, 241, 0.15)`, Border `#6366f1`, Text `#818cf8` (Indigo/Aurora Acc1).
  - `Flagship (>8 GB)`: Background `rgba(16, 185, 129, 0.15)`, Border `#10b981`, Text `#34d399` (Emerald).
  - `RAM Unknown`: Background `rgba(148, 163, 184, 0.15)`, Border `#94a3b8`, Text `#94a3b8` (Slate).
- **Readout Metrics**:
  - Memory: Detected physical RAM in GB (and advertised RAM estimate).
  - GPU: Classified chipset and target backend (e.g. `Adreno 730 → OpenCL`).
  - Storage: Free disk storage from `FileSystem.getFreeDiskStorageAsync()`.
  - Architecture: CPU ABI from `detectCpuArchitecture()` (e.g. `arm64-v8a`).

### 5.2 Recommendation Banner ("Accept" vs "Customize")
- **Layout**: Clear card displaying recommended Model, Context Window, and Max Output Tokens.
- **"Accept" Action (Primary)**:
  - Atomically writes `localModelName`, `localContextSize`, `localMaxTokens`, and sets `localConfigAutoApplied = true`.
  - Displays instant positive feedback: *"✓ Recommended settings applied."*
- **"Customize" Action (Secondary)**:
  - Reveals parameter sliders/inputs pre-filled with the recommended numbers.
  - Allows Owner to fine-tune context or tokens without starting from scratch.
  - Sets `localConfigAutoApplied = true`.

### 5.3 Dual UI Deployment
- **Local AI Settings (`client/app/settings/local-ai.tsx`)**: Full management with Capability Card, Recommendation Banner, model selector, overrides, and benchmark suite.
- **Setup / Onboarding (`client/app/setup.tsx`)**: In `Standalone -> On-Device Local AI`, replaces static placeholder card with compact Capability Card and Recommendation Banner, so first-time users configure their device safely before entering chat.

---

## 6. State Management & Per-Model Overrides (`useConfigStore`)

### 6.1 Schema Extension
In `client/store/useConfigStore.ts`:
```typescript
export interface ModelOverrideConfig {
  contextSize?: number;
  maxTokens?: number;
  gpuBackend?: GpuBackendPreference;
}

export interface ConfigState {
  // Existing fields...
  localModelName: string;
  localContextSize: number;
  localMaxTokens: number;
  gpuBackendPreference: GpuBackendPreference;

  // Per-model overrides dictionary
  modelOverrides: Record<string, ModelOverrideConfig>;
  setModelOverride: (modelName: string, override: Partial<ModelOverrideConfig>) => void;
  applyModelSettings: (modelName: string) => void;
}
```

### 6.2 State Resolution Lifecycle
1. When switching to `modelName`:
   - If `modelOverrides[modelName]` has values, load them into `localContextSize`, `localMaxTokens`, and `gpuBackendPreference`.
   - If no override exists, load default tier recommendations.
2. When Owner edits parameters in UI, update active values and write to `modelOverrides[localModelName]`.
3. Storage version bumped to **v10** with migration initializing `modelOverrides = {}`.

---

## 7. Implementation Roadmap for Subsequent Tickets
- **#615 (Store & Logic Implementation)**: Update `ramDetection.ts` with tier helper functions and `useConfigStore.ts` with `modelOverrides` + v10 migration + unit tests.
- **#616 (Reusable UI Components)**: Build `DeviceCapabilityCard.tsx` and `RecommendationBanner.tsx` with accessibility labels and visual tests.
- **#617 (Screen Integration)**: Integrate into `client/app/settings/local-ai.tsx` and `client/app/setup.tsx`.
- **#618 (Verification)**: Playwright E2E UI tests + visual baseline updates + run `python vela_ci.py ci`.

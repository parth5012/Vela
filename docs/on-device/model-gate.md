# On-Device Model Download & Device Capability Gate

> **Ticket**: [WF-05 (#420)](https://github.com/parth5012/Vela/issues/420)  
> **Parent Map**: [Wayfinder Map 1: On-device AI for Vela (#425)](https://github.com/parth5012/Vela/issues/425)  
> **Feeds**: [WF-06 Inference Foreground Service + Bridge (#415)](https://github.com/parth5012/Vela/issues/415)  
> **Product Decisions**: [DECISIONS.md](../../DECISIONS.md) (WF-01 #424)

---

## 1. Overview & Purpose

The **Model Download & Device Capability Gate** guarantees that Vela only attempts to download and execute on-device AI models on devices that have the hardware specifications, memory headroom, and storage required to run stably without invoking the Android Low Memory Killer (LMK) or exhausting local storage.

The gate enforces five core pillars:
1. **Device Capability Verification**: 6 GB RAM floor, >= 3 GB free disk space, and 64-bit `arm64-v8a` architecture.
2. **Three-State Lifecycle (`OK` / `DEGRADED` / `UNSUPPORTED`)**: Categorizes devices based on available memory and sets strict context-window budgets (4096 tokens vs 1024 tokens).
3. **Dynamic Remote Config**: Download URLs and cryptographic checksums are fetched dynamically from backend configuration and never hardcoded in client screens.
4. **Network Policy**: Wi-Fi only downloads by default, requiring an explicit user opt-in toggle to download over cellular data.
5. **Cryptographic Integrity & Recovery**: SHA-256 checksum verification with automatic cleanup of corrupt artifacts and partial download state.

---

## 2. Hardware Capability Gate Matrix

| Check | Requirement | Enforcement | Failure State |
|---|---|---|---|
| **RAM Tier** | Minimum **6.0 GB** physical RAM floor | `detectRamBytes()` via `Device.totalMemory` | `UNSUPPORTED` (<6 GB) |
| **Storage** | Minimum **3.0 GB** free internal storage | `FileSystem.getFreeDiskStorageAsync()` | `UNSUPPORTED` (<3 GB) |
| **Architecture** | **arm64-v8a** (64-bit ARM CPU) | `Device.supportedCpuArchitectures` | `UNSUPPORTED` (32-bit / incompatible) |
| **Emulator Flag** | `x86_64` permitted in dev/test only | `allowEmulator: true` parameter | `UNSUPPORTED` if not flagged |

### Status State Machine

```text
[Device Detection]
        │
        ├── RAM < 6 GB OR Disk < 3 GB OR Arch != arm64-v8a ──────► UNSUPPORTED (Route to Cloud Fallback)
        │
        ├── 6 GB <= RAM < 8 GB AND Disk >= 3 GB AND Arch == arm64-v8a ──► DEGRADED (1024-token context window)
        │
        └── RAM >= 8 GB AND Disk >= 3 GB AND Arch == arm64-v8a ────────► OK (4096-token full context window)
```

- **`OK`**: High-tier device with >= 8 GB RAM. Full 4096-token context window enabled.
- **`DEGRADED`**: Mid-tier device (6 GB <= RAM < 8 GB). The model runs on-device, but the KV cache context window is strictly pruned to 1024 tokens to guarantee memory safety under multitasking.
- **`UNSUPPORTED`**: The device is ineligible for local inference. The UI disables the local download button and automatically routes inference requests to the Cloud Fallback gateway (WF-10).

---

## 3. Dynamic Remote Configuration

Per **WF-01** product decisions, model download endpoints and artifact hashes are managed dynamically:

```json
{
  "modelId": "minicpm5-2b-int4",
  "name": "MiniCPM5-2B (LiteRT)",
  "downloadUrl": "https://huggingface.co/litert-community/MiniCPM5-2B/resolve/main/MiniCPM5-2B_int4.litertlm",
  "filename": "MiniCPM5-2B_int4.litertlm",
  "format": "litertlm",
  "sizeBytes": 1664299000,
  "sha256": "7b98f280a559d8717596d66e850b57e7eb372a9a83424696e19b4e7235b0ff72",
  "minRamGb": 6,
  "minStorageGb": 3
}
```

The client calls `fetchRemoteModelConfig(remoteUrl)` to obtain the active artifact specification.

---

## 4. Network Policy & Resumable Downloads

Because the MiniCPM5-2B INT4 artifact is **~1.55 GB**, unconstrained cellular downloads can lead to unexpected data charges:

- **Default Policy**: `wifiOnly = true`. If the device is on a cellular connection, downloads are blocked unless `allowCellular = true`.
- **User Confirmation**: If the user attempts to download on cellular with `wifiOnly` enabled, an explicit confirmation modal displays the exact file size and requires approval before proceeding.
- **Resumable State**: Downloads utilize `FileSystem.DownloadResumable` with persistent pause/resume snapshots stored in `AsyncStorage` under `download_resume_<modelId>`.

---

## 5. SHA-256 Integrity Verification & Corrupt Artifact Recovery

To prevent partial, truncated, or corrupted model files from crashing native runtimes, verification and recovery helpers are specified and provided in `client/utils/modelGate.ts` (`verifyArtifactIntegrity`, `recoverCorruptArtifact`):

1. **Pre-flight Range Check**: An HTTP `Range: bytes=0-15` request verifies file availability and format headers before downloading the full artifact.
2. **SHA-256 Digest**: Upon download completion, `verifyArtifactIntegrity(fileUri, expectedSha256)` computes the cryptographic hash.
3. **Corrupt Artifact Recovery**: If the digest fails to match `expectedSha256`:
   - The corrupt file is purged from disk via `FileSystem.deleteAsync(fileUri, { idempotent: true })`.
   - The resume state and status markers are deleted from `AsyncStorage`.
   - A recovery log is recorded and the user is prompted to re-download.

---

## 6. Implementation Reference

The gate logic is implemented and tested in:
- Implementation: `client/utils/modelGate.ts` (`ModelDownloadGate`, `ResumableModelDownloader`, `evaluateDeviceCapabilities`)
- Test Suite: `client/__tests__/modelGate.test.ts` (19/19 tests passing)
- RAM Detection Module: `client/utils/ramDetection.ts`
- Storage Integration: `client/utils/customModelStorage.ts`

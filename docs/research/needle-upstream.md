# Needle upstream research: engines, URLs, licences, headers, magic bytes

Ticket: https://github.com/parth5012/Vela/issues/292 (part of map #289)
Branch: `research/needle-upstream` (throwaway research branch, base `t3code/2d982711` @ `38a8dd1`)
Date: 2026-09-29 — all facts fetched live from primary sources (Hugging Face API, upstream
`github.com/cactus-compute/needle` source, HF `LICENSE` files, `nm` on downloaded archives).
Facts already verified in ticket #290 are cited here only when re-checked; anything not
re-verified is marked.

---

## 1. Per-ABI download layout (URLs + sizes)

Directory trees pulled from:

- `https://huggingface.co/api/models/Cactus-Compute/needle3/tree/main?recursive=true` (104 entries)
- `https://huggingface.co/api/models/Cactus-Compute/needle2/tree/main?recursive=true` (123 entries)

URL pattern for every file: `https://huggingface.co/Cactus-Compute/<repo>/resolve/main/<path>`

### needle3 (repo `Cactus-Compute/needle3`, HF sha `27c0a9a5b3ca…`)

| File | URL | Size (bytes) | Size |
|---|---|---:|---|
| `android-arm64/libneedle.a` | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/android-arm64/libneedle.a` | 1,664,680 | 1.59 MiB |
| `android-arm64/needle` (CLI ELF) | `…/resolve/main/android-arm64/needle` | 1,192,864 | 1.14 MiB |
| `android-arm64/needle.h` | `…/resolve/main/android-arm64/needle.h` | 1,187 | identical on all ABIs (md5 `f6e6939cfeee72f87c1dd71b28fb6de8`) |
| `android-armv7/libneedle.a` | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/android-armv7/libneedle.a` | 1,291,188 | 1.23 MiB |
| `android-armv7/needle` | `…/resolve/main/android-armv7/needle` | 703,536 | — |
| `android-riscv64/libneedle.a` | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/android-riscv64/libneedle.a` | 3,715,858 | 3.54 MiB |
| `android-riscv64/needle` | `…/resolve/main/android-riscv64/needle` | 1,040,256 | — |
| `needle3.cact` (weights, 20-layer) | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact` | 35,335,380 | 33.7 MiB (35.3 MB) |
| `checkpoints/needle3.safetensors` | `…/checkpoints/needle3.safetensors` | 242,047,978 | — |
| `config.json` | `…/resolve/main/config.json` | 1,273 | geometry source (§6) |
| `LICENSE` | `…/resolve/main/LICENSE` | 11,358 | Apache-2.0 (§4) |
| `README.md` | `…/resolve/main/README.md` | 7,504 | model card |

**No ABI missing** — all three Android ABIs present. Other platforms also shipped
(`ios-arm64`, `ios-sim-arm64`, `linux-{arm64,armv7,mipsel,riscv64,x86_64}`, `macos-arm64`,
`windows-{arm64,x86_64}`, `tvos-arm64`, `watchos-arm64`, `wasm/`, `wasm-component/`).
Engine binaries are **STATIC `libneedle.a` only — there is no `libneedle.so` anywhere in
the tree** (re-confirmed by full recursive listing).

### needle2 (repo `Cactus-Compute/needle2`, HF sha `32e9e3a93b20…`)

| File | URL | Size (bytes) | Size |
|---|---|---:|---|
| `android-arm64/libneedle.a` | `https://huggingface.co/Cactus-Compute/needle2/resolve/main/android-arm64/libneedle.a` | 20,729,982 | 19.77 MiB |
| `android-arm64/needle` | `…/resolve/main/android-arm64/needle` | 14,824,824 | — |
| `android-arm64/needle.h` | `…/resolve/main/android-arm64/needle.h` | 562 | per-repo identical |
| `android-armv7/libneedle.a` | `https://huggingface.co/Cactus-Compute/needle2/resolve/main/android-armv7/libneedle.a` | 17,965,132 | 17.14 MiB |
| `android-riscv64/libneedle.a` | `https://huggingface.co/Cactus-Compute/needle2/resolve/main/android-riscv64/libneedle.a` | 29,161,064 | 27.81 MiB |
| `needle2.cact` (weights, 45M) | `https://huggingface.co/Cactus-Compute/needle2/resolve/main/needle2.cact` | 13,737,807 | 13.10 MiB (13.7 MB) |
| `config.json` | `…/resolve/main/config.json` | 1,087 | geometry source (§6) |
| `LICENSE` | `…/resolve/main/LICENSE` | 11,358 | Apache-2.0, byte-identical to needle3 (md5 `3b83ef96387f14655fc854ddc3c6bd57`) |

**No ABI missing** for needle2 either.

### Exported C symbols (verified with `nm -g --defined-only` on the downloaded archives)

| Archive | Exported `needle_*` symbols |
|---|---|
| needle3 `android-arm64/libneedle.a` | `needle_init`, `needle_complete`, `needle_reset`, `needle_load`, `needle_embed`, `needle_last_error` |
| needle3 `android-armv7/libneedle.a` | same 6 |
| needle3 `android-riscv64/libneedle.a` | same 6 |
| needle2 `android-arm64/libneedle.a` | `needle_init`, `needle_complete`, `needle_reset`, `needle_load` (no `embed`, no `last_error`) |
| any of the above | **`needle_free` absent — 0 occurrences** |

### Dead old URL (re-checked)

`https://huggingface.co/cactus-ai/needle-45m/resolve/main/needle-45m.cact` → **HTTP 401**
(re-verified 2026-09-29; matches ticket #290). The stale entry still sits in
`client/utils/localLlm.ts:114-115`.

---

## 2. `.cact` magic bytes — `0x83` = v2, `0x84` = v3

The tag is a little-endian `u32` at byte offset 0 of the file:

| Model | Tag (u32) | First 4 bytes on disk |
|---|---|---|
| Needle 2 (`needle2.cact`) | `0x05E12A83` | `83 2A E1 05` |
| Needle 3 (`needle3.cact`) | `0x05E12A84` | `84 2A E1 05` |

Sources (all primary):

1. `needle/__init__.py` (upstream, `github.com/cactus-compute/needle`):
   `_CACT_GENERATIONS = {0x05E12A83: 2, 0x05E12A84: 3}` (lines 27–28); `_weight_generation`
   reads the first 4 bytes, decodes little-endian, maps to generation 2/3, and errors with
   "unknown .cact format tag" otherwise.
   URL: `https://raw.githubusercontent.com/cactus-compute/needle/main/needle/__init__.py`
2. `needle/model/export.py` (upstream): `TAG = 0x05E12A84` (line 101); the tag is packed
   **first** into the 196-byte header (`_HDR_FMT = "<48If"`, `struct.pack(_HDR_FMT, TAG, …)`
   at line 415); readers reject on mismatch: `if hdr[0] != TAG: raise ValueError(f"{path} is
   not a Needle 3 .cact archive")` (lines 372, 382, 462).
   URL: `https://raw.githubusercontent.com/cactus-compute/needle/main/needle/model/export.py`
3. `tests/test_weights.py` (upstream): fixtures write both tags explicitly —
   `(0x05E12A84).to_bytes(4, "little")` for needle3 base/v3 archives and
   `(0x05E12A83).to_bytes(4, "little")` for generation-2 archives (lines 77, 85, 92, 216).
4. Official format doc (Cactus, first-party): `https://cactuscompute.com/blog/cact-format` —
   *"The tag is the contract. `0x05E12A83` is the Needle 2 format and `0x05E12A84` is Needle 3;
   the Python package reads the first four bytes and picks the matching engine, and an engine
   handed the other generation's tag refuses with a message rather than guessing."*

### In-repo validation — MATCHES upstream

- The magic-byte validators are in **`client/utils/customModelStorage.ts`**, not
  `localLlm.ts` (the ticket's pointer was off by file; `localLlm.ts` only holds model URLs
  including the stale `cactus-ai/needle-45m` one).
- `sniffMagicBytes()` (`client/utils/customModelStorage.ts:44-72`) accepts exactly
  `83 2A E1 05` and `84 2A E1 05` for `cact`, with comments naming both tags.
- `preflightUrlMagicBytes()` (line 100) and `validateFileMagicBytes()` (line 192) both sit on
  top of `sniffMagicBytes`, so URL preflight and local-file validation share the same check.
  **Verdict: in-repo validation agrees with upstream, no change needed.**

---

## 3. Header diff: stale in-repo vs current upstream

- Stale: `client/modules/needle/android/src/main/cpp/needle.h` (17 lines, in this repo)
- Upstream needle3: `https://huggingface.co/Cactus-Compute/needle3/resolve/main/android-arm64/needle.h`
  (1,187 bytes; byte-identical across all needle3 ABI folders, md5 `f6e6939cfeee72f87c1dd71b28fb6de8`)
- Upstream needle2: `https://huggingface.co/Cactus-Compute/needle2/resolve/main/android-arm64/needle.h`
  (562 bytes)

| API surface | Stale in-repo header | Upstream needle3 header | Upstream needle2 header |
|---|---|---|---|
| `needle_init(system_prompt, tools_json, tool_index_path)` | `int`, undocumented | `NEEDLE_API int`; returns **tokenized static-prefix length** on success (≥ 0), negative on failure | same as needle3 |
| `needle_last_error()` | **absent** | `NEEDLE_API const char* needle_last_error(void)` — process-global error, valid until next API call | **absent** |
| `needle_complete(input, max_new_tokens, out, out_capacity)` | `int` | `NEEDLE_API int` — same signature | same |
| `needle_embed(input, out, out_capacity)` | **absent** | `NEEDLE_API int`; `out == NULL` returns embedding dim without computing | **absent** |
| `needle_reset()` | **`int needle_reset(void)`** | **`NEEDLE_API void needle_reset(void)`** | **`void`** |
| `needle_load(cact, n)` | **absent** | `NEEDLE_API int needle_load(const unsigned char*, unsigned long long)` | same |
| `needle_free()` | **`int needle_free(void)` present** | **absent** (0 `nm` occurrences in every Android archive) | **absent** |
| `NEEDLE_API` visibility macro | absent | present (`__attribute__((visibility("default")))`) | present |
| Threading/model doc | none | "One process-global, non-thread-safe model." | none |
| Success convention | consumer treats `rc == 0` as success (see below) | "Negative returns indicate failure" → **`rc >= 0` = success** | same |

### Success-convention change, with local evidence

Upstream callers treat negative as the only failure:

- `needle/__init__.py`: `if lib.needle_load(data, len(data)) < 0`, `if lib.needle_init(...) < 0`,
  `if rc < 0` after `needle_complete`, `dim <= 0` / `rc != dim` for `needle_embed`.
- needle3 HF README: "call `needle_last_error()` after a **negative return**".

Stale in-repo JNI still uses the old `rc == 0` convention
(`client/modules/needle/android/src/main/cpp/needle-jni.cpp`):

| Line | Code | Problem against new engine |
|---:|---|---|
| 35 | `g_initialized = (rc == 0);` | `needle_init` now returns the static-prefix token count (≥ 0 on success) → any non-empty prefix (e.g. 42) is misread as failure |
| 71–78 | `if (rc == 0) { … } else "Error in needle_complete inference"` | new convention: only `rc < 0` is an error; `rc == 0` is merely a valid non-negative return |
| 105–106 | `int rc = needle_reset(); return (rc == 0) ? …` | upstream `needle_reset` returns **`void`** → declared/defined return-type mismatch (UB) |
| 119–120 | `int rc = needle_free(); …` | **`needle_free` no longer exists** → undefined reference at link time against the new `.a` |

Net effect: vendoring the new per-ABI `libneedle.a` requires updating the header to the
upstream one and rewriting these four JNI sites (`rc >= 0`, drop `needle_free`, treat
`needle_reset` as `void`, surface `needle_last_error`).

---

## 4. Redistribution licence

| Item | Finding | Source |
|---|---|---|
| Engine binaries (`libneedle.a`, `needle` CLI) | **Apache License 2.0** (standard text, 11,358 bytes) | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/LICENSE` (identical file in needle2 repo; md5 `3b83ef96387f14655fc854ddc3c6bd57` both) |
| Weights (`needle2.cact`, `needle3.cact`) | Model cards declare `license: apache-2.0` in YAML front-matter and HF `cardData.license = apache-2.0`; no separate/extra terms anywhere in either README body | HF API `https://huggingface.co/api/models/Cactus-Compute/needle2`, `…/needle3`; `…/needle2/resolve/main/README.md` line 4; `…/needle3/resolve/main/README.md` line 4 |
| Upstream source repo | `github.com/cactus-compute/needle` — GitHub API reports `Apache-2.0` | `https://api.github.com/repos/cactus-compute/needle` |
| `NOTICE` file | **None** in either HF tree, and none in the GitHub repo root → Apache-2.0 §4 NOTICE-preservation obligation is not triggered | recursive HF tree listings (§1) + GitHub tree listing |
| Attribution we must ship when vendoring `.a`/`.cact` into the APK | Apache-2.0 §4: keep the LICENSE text + patent/credits notices, state that we modified anything (we won't). Practically: include the Apache-2.0 text and a "Needle engine & model © Cactus Compute, Inc. — Apache License 2.0" line in an open-source-licenses screen. | standard Apache-2.0 obligations against the LICENSE above |
| BibTeX "please cite" in both READMEs | Academic courtesy request, **not** a licence condition — no obligation for the Android app | needle2/needle3 README "Citation" sections |

**Verdict: redistribution of `.a` and `.cact` inside the APK is allowed under Apache-2.0 with
a licence/attribution notice; no copyleft, no share-alike, no field-of-use restriction found.**

---

## 5. Does a ladder (layer-slice variants) exist upstream?

Short answer: **the ladder exists as a build capability; no per-depth slice files are
published on Hugging Face.**

- needle3 README (line 28): "trained so that **every depth from 2 to 20 layers is a
  deployable model**"; (line 78): `needle build [--layers N]` merges a LoRA adapter, "slices
  any subnetwork from 2 to 20 layers and exports a **4-bit** `.cact` that runs on the same
  engine".
- needle3 README (line 16): "The whole model is a single **8-29 MB** file" — this is the
  origin of the "8-29 MB" figure in the map. It is a marketing size-range claim across the
  ladder; it does **not** match the only published weight file (see open questions).
- HF tree of `Cactus-Compute/needle3` contains exactly **one** `.cact`: `needle3.cact`
  (35,335,380 B, the full 20-layer, 2-bit archive) plus `checkpoints/needle3.safetensors`.
  No 4-/8-/12-layer `.cact`, no `*-8L.cact` etc. Same for `Cactus-Compute/needle2`
  (only `needle2.cact`). `Cactus-Compute/needle-pebble-ft` ships raw `.weights` for a
  Pebble fine-tune — not a needle3 ladder slice.
- Sized ladder slices exist only behind the paid/authenticated **Cactus Platform**:
  `needle/platform.py` `download(model_id, out, depth=N)` reads a `variants` list
  (`{id, depth, bytes}`) from the platform API and fetches `models/<variant-id>/content`
  via signed links — requires platform credentials, so sizes are **not publicly listable**
  (unverified).
- Consistent with map decision: only the full 20-layer `needle3.cact` is in scope; the
  ladder stays deferred. If the ladder is ever picked up: **self-build** via
  `needle build --layers N` (no download-only path).

---

## 6. Context-number reconciliation — what "256 sliding window" actually means

Two different, both-real 256s; the phrasing "256 sliding window" conflates them.

| Knob | needle3 | needle2 |
|---|---|---|
| Context / `max_position_embeddings` | **8192** | 2048 |
| `sliding_window` (local attention window) | **1024** | **256** |
| `kv_window` (KV-cache window) | **256** | (no `kv_window` key in config) |
| `num_hidden_layers` | 20 | 27 |

Sources: `https://huggingface.co/Cactus-Compute/needle3/resolve/main/config.json`
(`"max_position_embeddings": 8192`, `"sliding_window": 1024`, `"kv_window": 256`) and
`https://huggingface.co/Cactus-Compute/needle2/resolve/main/config.json`
(`"max_position_embeddings": 2048`, `"sliding_window": 256`).

So the map's "context 256 sliding window" should read:

- **needle-3 triple = 8192 context / 1024 sliding window / 256 KV window** — matches
  ticket #290's established geometry; the 256 there is the **KV window**, not the sliding
  window.
- needle-2 has its **sliding window = 256** (context 2048) — probably where the phrase
  "256 sliding window" originally came from.
- Both `sliding_window` and `kv_window` are written into the `.cact` header by
  `needle/model/export.py` (`struct.pack(_HDR_FMT, TAG, …, kv_window, kv_bits, …,
  sliding_window, …)`), so the engine reads them from the file at load.

---

## 7. Open questions / could not verify

1. **"8-29 MB" vs shipped 35.3 MB.** needle3 README claims "a single 8-29 MB file", but the
   only published `needle3.cact` is 35,335,380 B (35.3 MB). Most likely the range refers to
   ladder depths (2-layer ≈ 8 MB … some depth ≈ 29 MB) or a different quantisation, but
   **no source states this explicitly — unverified.** Do not cite "8-29 MB" as the size of
   the file we will ship.
2. **Cactus Platform ladder variant sizes (`bytes` per depth)** — API requires platform
   credentials; sizes unverified.
3. **`.cact` internal layout beyond the tag + 196-byte header** — we confirmed tag offset 0,
   header length (196 B, `_HDR_FMT = "<48If"` = 49 × 32-bit fields, corroborated by the
   cact-format blog "Header, 196 bytes") and that `kv_window`/`sliding_window` live in it;
   full field-by-field layout was out of scope.
4. **Whether the needle2 engine binary also embeds `needle_embed` under a different symbol
   name** — `nm` shows only the 4 `needle_*` exports, so no; but we did not disassemble to
   check for non-`needle_`-prefixed entry points (WASM `needle.wit` for generation 2 exports
   `load/init/complete/reset` only, consistent).
5. **HTTP behaviour of HF redirect chains / CDN caching** — sizes are as reported by the HF
   API tree at fetch time; they will change if upstream re-uploads (pin by HF commit sha:
   needle3 `27c0a9a5b3ca…`, needle2 `32e9e3a93b20…`, captured 2026-09-29).

---

## 8. Sources index

| Fact | URL |
|---|---|
| needle3 file tree + sizes | `https://huggingface.co/api/models/Cactus-Compute/needle3/tree/main?recursive=true` |
| needle2 file tree + sizes | `https://huggingface.co/api/models/Cactus-Compute/needle2/tree/main?recursive=true` |
| needle3 upstream header | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/android-arm64/needle.h` |
| needle2 upstream header | `https://huggingface.co/Cactus-Compute/needle2/resolve/main/android-arm64/needle.h` |
| Licence (both repos) | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/LICENSE`, `https://huggingface.co/Cactus-Compute/needle2/resolve/main/LICENSE` |
| Model-card licence metadata | `https://huggingface.co/api/models/Cactus-Compute/needle3`, `…/needle2` |
| needle3 geometry | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/config.json` |
| needle2 geometry | `https://huggingface.co/Cactus-Compute/needle2/resolve/main/config.json` |
| Tag → generation map | `https://raw.githubusercontent.com/cactus-compute/needle/main/needle/__init__.py` |
| Tag constant + header pack | `https://raw.githubusercontent.com/cactus-compute/needle/main/needle/model/export.py` |
| Tag fixtures in tests | `https://raw.githubusercontent.com/cactus-compute/needle/main/tests/test_weights.py` |
| HF repo mapping used upstream | `https://raw.githubusercontent.com/cactus-compute/needle/main/needle/agent/fetch.py` |
| Platform ladder download (auth) | `https://raw.githubusercontent.com/cactus-compute/needle/main/needle/platform.py` |
| `.cact` format / tag contract | `https://cactuscompute.com/blog/cact-format` |
| needle3 model card | `https://huggingface.co/Cactus-Compute/needle3/resolve/main/README.md` |
| needle2 model card | `https://huggingface.co/Cactus-Compute/needle2/resolve/main/README.md` |
| Dead old URL | `https://huggingface.co/cactus-ai/needle-45m/resolve/main/needle-45m.cact` → HTTP 401 |
| In-repo magic validation | `client/utils/customModelStorage.ts:44-72, 100, 192` |
| Stale header | `client/modules/needle/android/src/main/cpp/needle.h` |
| Stale JNI `rc == 0` sites | `client/modules/needle/android/src/main/cpp/needle-jni.cpp:35,71-78,105-106,119-120` |
| Stale model URL | `client/utils/localLlm.ts:114-115` |

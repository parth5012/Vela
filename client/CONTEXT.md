# Context — Vela Client

Single context for the Vela Android AI assistant app (Expo SDK 57).

## Glossary

- **OAuth callback** — the deep link `vela-client://oauth/callback` that the Vela backend redirects to after Google OAuth completes or fails. Carries the verdict as a query param.
- **Callback verdict** — the `status` query param on the OAuth callback: `success` or `error`. An `error` verdict also carries a human-readable `message` param.
- **In-session callback** — a callback caught by `expo-web-browser` while the `openAuthSessionAsync` promise is alive; surfaces as `result.url`.
- **Cold-start callback** — a callback delivered by the OS to a freshly launched app instance (`Linking.getInitialURL`), with no live browser session. Currently out of scope for the OAuth popup effort.
- **Vela backend** — the sibling repo `D:\work\projects\Vela`; owns the Google OAuth flow and the `/oauth/token/status` sync endpoint.

## Local (on-device) LLM

Three engines, three formats — they are NOT interchangeable:

- **LiteRT `.task` bundle** — the only model format MediaPipe `tasks-genai`
  accepts (that is a MediaPipe limit, not an app limit). A zip containing
  `TF_LITE_PREFILL_DECODE`, `TOKENIZER_MODEL`, and `METADATA`.
  **GGUF is a llama.cpp format and will never load in MediaPipe** — feeding one
  to `LlmInference` aborts the process natively.
- **GGUF** — llama.cpp via `llama.rn`; needs the Native (New Architecture) build.
- **`.cact`** — the static Needle engine (below).

- **Model source** — the ungated `litert-community` HuggingFace repos. Every
  `google/*` and Gemma LiteRT repo is gated (HTTP 401 without a token plus
  license acceptance), which is why Gemma is not in `LOCAL_MODELS`.
- **`LOCAL_MODELS`** — single source of truth in `utils/localLlm.ts`. Both
  `app/settings.tsx` and `app/index.tsx` import it; they previously kept
  independent copies that silently drifted to different URLs.
- **Mock fallback** — when native inference is unavailable, `streamLocalLlmResponse`
  emits simulated text. It now prefixes output with
  `[Mock mode — the local model is NOT running] <reason>` so a broken model can
  never be mistaken for a working one. Check `getLocalLlmFallbackReason()`.

### Needle `.cact` models (Wayfinder #289)

- **Two models ship, not three** — `Needle-2 45M` (2048 context) and
  `Needle-3 (20-layer)` (8192 context) in `LOCAL_MODELS`.
  **Needle-1 (26M safetensors) is out of scope** — decided in #290
  (format/contract/licence mismatch). Never write "3 models".
- **Model source** — `Cactus-Compute/needle2` and `Cactus-Compute/needle3`
  (`needle2.cact`, `needle3.cact`). The old `cactus-ai/needle-45m` URL is dead
  (HTTP 401); it was hard-migrated away in #294.
- **Per-version magic** — 4-byte tags `0x05E12A83` (needle2) and `0x05E12A84`
  (needle3). Both sniff as `format: 'cact'`, so version-aware consumers read the
  separate `variant` field from `sniffNeedleVariant()` (`'needle2' |
  'needle3' | null`; non-null implies `format === 'cact'`).
- **Contexts** — needle2 2048 with a 256-token sliding window; needle3 8192 with
  a 1024-token local window and a 256-token KV window. The older "256" wording
  conflated the two models.
- **Engine** — static `libneedle.a` fetched at build (upstream ships no `.so`)
  into the gitignored `modules/needle/android/engine/<model>/<abi>/`, verified
  against the pinned SHA256s in `modules/needle/scripts/engine.lock.json`.
  Selection is **link-time** (`-DNEEDLE_ENGINE_MODEL`, default needle3), never
  at runtime. Pin mismatch / missing `node` / unsupported ABI ⇒
  `HAVE_NEEDLE_ENGINE=0` and the deterministic mock stub still builds.
- **Honest engine fallback** — Settings → Local AI shows the engine pill:
  `⚡ Accelerated (native)` when `NeedleModule.hasNativeLibrary()` is true,
  `⚠️ Mock Fallback` otherwise. Loading a `.cact` model with the mock build is
  blocked with a warning — mock output is never served silently.
- **JSON extraction screen** — `/settings/extract` passes the Owner's schema as
  the *only* tool to `needle_init`; an empty `function_calls[]` is a refusal,
  a distinct terminal state from `parse_failure`. Engine is released after every
  run so the schema tool never leaks into chat's agent loop.
- **Licence** — Apache-2.0 engine and weights; attribution ships in
  `modules/needle/android/THIRD_PARTY_NOTICES.md`.
- **Verification status (honest)** — the dev environment used for this map has
  no Android NDK/SDK, so NDK compile/link, Gradle packaging, and on-device load
  are **unproven** (host CMake configure + `g++ -fsyntax-only` only prove
  configure/syntax). The `needle_embed` quality gate is **UNRUN** and its UI
  half is parked; hybrid-search merge weights are PLACEHOLDER. Ladder slice
  sizes (4/8/12-layer) are unverified and out of scope; the
  `act`/`confirm`/`refuse` confidence UX is not yet specified.

### Version constraint (do not downgrade) — MediaPipe `.task` only

`com.google.mediapipe:tasks-genai` must stay at **0.10.24 or newer**. Version
0.10.14 dies with a native `SIGABRT` when opening current `.task` bundles:

```
llm_engine.cc:244 Check failed: graph_->WaitUntilIdle() is OK
  TfLitePrefillDecodeRunnerCalculator ... RET_CHECK (interpreter_)!=(nullptr)
```

Its bundled TFLite runtime is too old to build an interpreter. This is an
`abort()` — no Kotlin `try/catch` can intercept it, so the app hard-crashes.

The API also changed at 0.10.24: `setResultListener`/`setErrorListener` were
removed from `LlmInferenceOptions.Builder`; streaming is now
`generateResponseAsync(prompt, ProgressListener)` returning a `ListenableFuture`.
Verify signatures with `javap` on the AAR's `classes.jar` before upgrading again.

**Caveat:** `client/android/` is gitignored, so this dependency lives only on
disk and is lost on `expo prebuild --clean`. It belongs in an Expo config plugin.

## Chat Interface

- **Message Timestamp** — the localized presentation of a message's creation time (`created_at`), pinned to the message bubble footer.
- **Date Divider** — a centered, non-interactive visual badge separating messages between different calendar days in a conversation feed.
- **Day Cluster** — a contiguous sequence of messages sent within the same calendar day in the Owner's local timezone.


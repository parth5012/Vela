# Context — Vela Client

Single context for the Vela Android AI assistant app (Expo SDK 57).

## Glossary

- **OAuth callback** — the deep link `vela-client://oauth/callback` that the Vela backend redirects to after Google OAuth completes or fails. Carries the verdict as a query param.
- **Callback verdict** — the `status` query param on the OAuth callback: `success` or `error`. An `error` verdict also carries a human-readable `message` param.
- **In-session callback** — a callback caught by `expo-web-browser` while the `openAuthSessionAsync` promise is alive; surfaces as `result.url`.
- **Cold-start callback** — a callback delivered by the OS to a freshly launched app instance (`Linking.getInitialURL`), with no live browser session. Currently out of scope for the OAuth popup effort.
- **Vela backend** — the sibling repo `D:\work\projects\Vela`; owns the Google OAuth flow and the `/oauth/token/status` sync endpoint.

## Local (on-device) LLM

- **LiteRT `.task` bundle** — the ONLY model format MediaPipe `tasks-genai` accepts.
  A zip containing `TF_LITE_PREFILL_DECODE`, `TOKENIZER_MODEL`, and `METADATA`.
  **GGUF is a llama.cpp format and will never load** — feeding one to
  `LlmInference` aborts the process natively.
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

### Version constraint (do not downgrade)

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

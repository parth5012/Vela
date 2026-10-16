/**
 * Web-only stand-in for `llama.rn` (native-only, no web build).
 *
 * Aliased in `metro.config.js` when `platform === 'web'` so the app can be
 * previewed in a browser for design review. Android/iOS still resolve the real
 * package. Local GGUF inference simply is unavailable here — matching the app's
 * own "never serve a silent mock" rule, this throws rather than faking output.
 */
export async function initLlama(): Promise<never> {
  throw new Error('llama.rn is native-only: GGUF inference is unavailable on web.');
}

export class LlamaContext {
  // Type-only placeholder for `let llamaContext: LlamaContext | null`.
}

export default { initLlama, LlamaContext };

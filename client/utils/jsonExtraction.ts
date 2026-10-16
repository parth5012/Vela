import AsyncStorage from '@react-native-async-storage/async-storage';
import NeedleModule from '../modules/needle';
import { useConfigStore } from '../store/useConfigStore';
import {
  getLocalLlmFallbackReason,
  isUsingMockFallback,
  isLocalLlmDown,
  isLocalModelLoaded,
  localModelStorageKey,
  unloadLocalModel,
} from './localLlm';
import { parseToolCall } from './localAgentLoop';

/**
 * On-device JSON extraction (#298, "local Jev" option 1 of #290).
 *
 * The pasted schema is declared as the ONLY tool passed to
 * needle_init/needle_complete: with one declared tool the decode grammar
 * admits exactly one call of that name, so schema conformance is guaranteed
 * rather than requested (upstream needle structured-extraction contract).
 * The result is `function_calls[0].arguments` + `confidence` straight from
 * #295's parseToolCall — typed, machine-consumable, no prose, no chat wrapper.
 *
 * No network: the whole path runs through NeedleModule (native) only.
 */

/** The single tool the schema is wrapped in (needle tools_json shape). */
export const EXTRACTION_TOOL_NAME = 'record';

const EXTRACTION_TOOL_DESCRIPTION =
  'The record extracted from the text, matching the declared schema exactly.';

/**
 * Generation cap for one extraction (matches upstream needle.extract's
 * max_new_tokens default of 256; needle2's window is 256 tokens).
 */
export const EXTRACTION_MAX_TOKENS = 256;

/** Input ceiling for schema + source text before anything crosses JNI. */
export const MAX_INPUT_CHARS = 65536;

export type ExtractionStatus =
  | 'success'
  | 'refusal'
  | 'parse_failure'
  | 'engine_error'
  | 'invalid_schema'
  | 'input_too_large'
  | 'mock';

export interface ExtractionResult {
  status: ExtractionStatus;
  /** Parsed `function_calls[0].arguments` — only on success. */
  data?: Record<string, any>;
  /** Pretty-printed JSON of `data` — only on success. */
  json?: string;
  /** Engine-reported confidence in [0,1]; undefined when not reported. NEVER invented. */
  confidence?: number;
  /** Engine rationale / refusal text / human-readable error detail. */
  message?: string;
  /** Engine rationale alongside the call (#295 envelope). */
  reasoning?: string;
  /** Raw engine output for non-success states (debugging aid). */
  raw?: string;
  /** True only for the mock path — mock output is never a real extraction. */
  mock: boolean;
  /** Why the mock path was taken (capability-honesty reason, #291). */
  mockReason?: string;
}

export type BuildToolsResult =
  | { ok: true; toolsJson: string }
  | { ok: false; error: string };

/**
 * Wraps a pasted JSON object schema as the ONLY tool in the array handed to
 * needle_init's `tools_json` slot (and mirrored on needle_complete from JS).
 * Upstream tools.json shape: `[{name, description, parameters}]`.
 */
export function buildSchemaOnlyToolsJson(schemaText: string): BuildToolsResult {
  const trimmed = (schemaText || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Schema is empty. Paste a JSON object schema, e.g. {"type":"object","properties":{...}}.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: any) {
    return { ok: false, error: `Schema is not valid JSON: ${err?.message || String(err)}` };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: 'Schema must be a JSON object, e.g. {"type":"object","properties":{...}}.',
    };
  }

  const schema = parsed as Record<string, unknown>;
  if (schema.type !== undefined && schema.type !== 'object') {
    return { ok: false, error: 'Schema must describe an object ("type": "object").' };
  }

  const tools = [
    {
      name: EXTRACTION_TOOL_NAME,
      description: EXTRACTION_TOOL_DESCRIPTION,
      parameters: schema,
    },
  ];
  return { ok: true, toolsJson: JSON.stringify(tools) };
}

/**
 * Capability honesty (#291/#298): is the real on-device Needle engine
 * available, or is this build/run on the mock path? Mock output must never be
 * presented as a schema-conforming extraction.
 */
export function getExtractionMockState(): { mock: boolean; reason: string | null } {
  let reason: string | null = null;
  try {
    if (!NeedleModule.hasNativeLibrary()) {
      reason =
        'The Needle native library is not packaged in this build (mock fallback stub is active). Use a development build with the Needle engine.';
    }
  } catch {
    reason = 'Needle native library unavailable in this build.';
  }
  if (!reason) reason = getLocalLlmFallbackReason();
  if (!reason && isUsingMockFallback()) {
    reason = 'Local inference is running on the mock fallback path.';
  }
  return { mock: !!reason, reason };
}

/**
 * Pure interpretation of one engine completion (#295 envelope via
 * parseToolCall). Terminal states: success / refusal / parse_failure /
 * engine_error.
 */
export function parseExtractionEnvelope(text: string): ExtractionResult {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return {
      status: 'parse_failure',
      mock: false,
      message: 'The engine returned no output.',
    };
  }

  // NeedleModule surfaces needle_complete failures as "Error: <detail>".
  if (trimmed.startsWith('Error:')) {
    return {
      status: 'engine_error',
      mock: false,
      message: trimmed.slice('Error:'.length).trim() || 'The Needle engine reported an error.',
      raw: trimmed,
    };
  }

  const call = parseToolCall(trimmed);
  if (!call) {
    return {
      status: 'parse_failure',
      mock: false,
      message: 'Output was not a well-formed extraction envelope.',
      raw: trimmed,
    };
  }

  if (call.refusal) {
    return {
      status: 'refusal',
      mock: false,
      message: call.refusal,
      reasoning: call.reasoning,
      confidence: call.confidence,
      raw: call.raw,
    };
  }

  const args = call.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {
      status: 'parse_failure',
      mock: false,
      message: 'The engine returned a call without object arguments.',
      raw: call.raw,
    };
  }

  return {
    status: 'success',
    mock: false,
    data: args,
    json: JSON.stringify(args, null, 2),
    confidence: call.confidence,
    reasoning: call.reasoning,
  };
}

/**
 * Releases the engine after an extraction so no schema-tool declaration leaks
 * into the chat agent loop: reset (#293 lifecycle tail) then unload, leaving
 * the engine uninitialized either way — the chat path calls
 * initializeLocalModel() again on its next message.
 */
async function releaseExtractionEngine(): Promise<void> {
  try {
    await NeedleModule.reset();
  } catch (err) {
    console.warn('[jsonExtraction] needle reset failed:', err);
  }
  try {
    if (isLocalModelLoaded) {
      await unloadLocalModel();
    } else {
      await NeedleModule.unload();
    }
  } catch (err) {
    console.warn('[jsonExtraction] needle unload failed:', err);
  }
}

/**
 * Runs one fully-local extraction: needle_load -> needle_init (schema as the
 * ONLY tool) -> complete -> reset. Never throws; every outcome is a typed
 * terminal state. Mock/fallback runs short-circuit to `status: 'mock'` so mock
 * text is never presented as a real extraction.
 */
export async function runJsonExtraction(
  schemaText: string,
  sourceText: string
): Promise<ExtractionResult> {
  const built = buildSchemaOnlyToolsJson(schemaText);
  if (!built.ok) {
    return { status: 'invalid_schema', mock: false, message: built.error };
  }

  const source = (sourceText || '').trim();
  if (!source) {
    return {
      status: 'invalid_schema',
      mock: false,
      message: 'Source text is empty. Paste the text to extract from.',
    };
  }

  // Guard before anything crosses JNI: a giant clipboard paste would allocate
  // and tokenise on-device long before the model's context cap rejects it.
  if (schemaText.length > MAX_INPUT_CHARS || source.length > MAX_INPUT_CHARS) {
    return {
      status: 'input_too_large',
      mock: false,
      message: `Input exceeds ${MAX_INPUT_CHARS} characters. Trim the schema or the source text.`,
    };
  }

  const mockState = getExtractionMockState();
  if (mockState.mock) {
    return {
      status: 'mock',
      mock: true,
      mockReason: mockState.reason || 'Local engine unavailable.',
      message: 'On-device extraction unavailable — no extraction was performed.',
    };
  }

  if (isLocalLlmDown) {
    return {
      status: 'engine_error',
      mock: false,
      message: 'Local LLM is down/unavailable.',
    };
  }

  const localModelName = useConfigStore.getState().localModelName;
  const modelPath = await AsyncStorage.getItem(`${localModelStorageKey(localModelName)}_path`);
  if (!modelPath) {
    return {
      status: 'engine_error',
      mock: false,
      message: `No downloaded model found for "${localModelName}". Download a Needle model (.cact) in Settings -> Local AI first.`,
    };
  }
  if (!modelPath.toLowerCase().endsWith('.cact')) {
    return {
      status: 'engine_error',
      mock: false,
      message: `JSON extraction needs a Needle model (.cact); "${localModelName}" is not one. Select Needle-2 45M or Needle-3 (20-layer) in Settings -> Local AI.`,
    };
  }

  const cleanPath = modelPath.startsWith('file://') ? modelPath.slice(7) : modelPath;
  const ctxSize = useConfigStore.getState().localContextSize || 256;

  let outcome: ExtractionResult;
  try {
    // #293 lifecycle: needle_load -> needle_init with the schema as the only
    // statically-declared tool (grammar compiles from it before token one).
    const ok = await NeedleModule.init(cleanPath, ctxSize, '', '', built.toolsJson);
    if (!ok) {
      outcome = {
        status: 'engine_error',
        mock: false,
        message: 'needle_init failed (needle_last_error returned no detail).',
      };
    } else {
      // The passage sits where the query sits; tools also ride along on
      // complete (JS API) even though the grammar was fixed at init.
      const res = await NeedleModule.complete(source, built.toolsJson, EXTRACTION_MAX_TOKENS);
      outcome = parseExtractionEnvelope(res?.text ?? '');
    }
  } catch (err: any) {
    // Kotlin surfaces needle_last_error() detail through the rejection.
    outcome = {
      status: 'engine_error',
      mock: false,
      message: err?.message || String(err),
    };
  } finally {
    await releaseExtractionEngine();
  }

  return outcome;
}

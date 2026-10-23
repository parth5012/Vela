/**
 * Module: client/utils/needleAutomation
 * Intent: Expose the on-device Needle engine as a *device-automation tool* for a
 *   planner LLM (Gemma / Qwen / DeepSeek …), so a bigger model plans and Needle
 *   turns each step into concrete device tool calls that we execute.
 * Responsibilities: pick a downloaded `.cact` model, swap the local engine to
 *   Needle, run the existing agent loop (`runLocalAgentLoop`), restore the
 *   planner model, and return a compact transcript the planner can read.
 * Public API: runNeedleDeviceAutomation(instruction, { maxSteps, conversationId, deps })
 * Invariants:
 *   - The app's engine manager allows ONE local engine at a time, so the planner
 *     is unloaded before Needle loads and reloaded afterwards (see
 *     `initializeLocalModel`). Never two runtimes at once.
 *   - When the planner *is* the Needle model (`.cact` selected), no swap happens
 *     and the loop runs on the already-loaded engine.
 *   - No needle model downloaded → explicit failure text, never a silent mock.
 * Side Effects: engine load/unload (native), AsyncStorage reads, device actions
 *   via the agent loop, per-step rows in operationLog.
 * Maintenance: keep the transcript format stable — the planner prompt sees it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LOCAL_MODELS,
  getLoadedModelName,
  initializeLocalModel,
  isStoredModelUsable,
  localModelStorageKey,
  unloadLocalModel,
} from './localLlm';
import NeedleModule from '../modules/needle';
import { runLocalAgentLoop, type LocalAgentLoopResult } from './localAgentLoop';

/**
 * A downloaded model counts as available when its persisted record is usable:
 * the flag is set, a path exists, and the file format matches the model list.
 * Checking only the path (as this used to) treats a leftover `_path` key as a
 * downloaded model, swaps the engine, and then fails at load time.
 */
async function isModelDownloaded(name: string): Promise<boolean> {
  const spec = LOCAL_MODELS.find((m) => m.name === name);
  if (!spec) return false;
  try {
    const key = localModelStorageKey(name);
    const [flag, path] = await Promise.all([
      AsyncStorage.getItem(key),
      AsyncStorage.getItem(`${key}_path`),
    ]);
    return isStoredModelUsable(spec, flag, path);
  } catch {
    return false;
  }
}

export interface NeedleAutomationDeps {
  isModelDownloaded?: (name: string) => Promise<boolean>;
  getLoadedModel?: () => string | null;
  loadModel?: (name: string) => Promise<void>;
  unloadModel?: () => Promise<void>;
  runLoop?: (
    instruction: string,
    opts: { maxSteps?: number; conversationId?: string }
  ) => Promise<LocalAgentLoopResult>;
  /** True when the app packages the real Needle engine, not the mock stub. */
  hasNativeLibrary?: () => boolean;
}

export interface NeedleAutomationOptions {
  maxSteps?: number;
  conversationId?: string;
  deps?: NeedleAutomationDeps;
}

export interface NeedleAutomationResult {
  ok: boolean;
  /** Human-readable transcript. Always populated — success or failure. */
  output: string;
  model?: string;
  steps?: number;
}

/** Every shipped `.cact` model (only Needle-3 today). */
export function needleModelNames(): string[] {
  return LOCAL_MODELS.filter((m) => m.format === 'cact').map((m) => m.name);
}

/**
 * Picks the Needle model to drive device automation: the loaded one if it is
 * already a `.cact` engine, otherwise the first downloaded `.cact` model.
 */
export async function resolveNeedleAutomationModel(
  deps: NeedleAutomationDeps = {}
): Promise<string | null> {
  const isDownloaded = deps.isModelDownloaded ?? isModelDownloaded;
  const getLoaded = deps.getLoadedModel ?? getLoadedModelName;

  const candidates = needleModelNames();
  const loaded = getLoaded();

  if (loaded && candidates.includes(loaded)) {
    return loaded;
  }
  for (const name of candidates) {
    if (await isDownloaded(name)) return name;
  }
  return null;
}

/** Renders the loop's steps for the planner: tool, args and what happened. */
export function formatNeedleTranscript(result: LocalAgentLoopResult): string {
  const lines: string[] = [];
  for (const step of result.steps) {
    if (step.toolCall) {
      const args = [
        step.toolCall.target ? `target=${step.toolCall.target}` : '',
        step.toolCall.value ? `value=${step.toolCall.value}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `${step.step}. ${step.toolCall.toolName}${args ? ` (${args})` : ''} -> ${
          step.executionStatus ?? 'unknown'
        }: ${step.observation ?? 'no observation'}`
      );
    } else {
      lines.push(`${step.step}. (no tool call) ${step.response.trim()}`);
    }
  }
  const status = result.completed
    ? `completed in ${result.steps.length} step(s)`
    : `stopped after ${result.steps.length} step(s) without finishing`;
  lines.push(`Result: ${status}.`);
  return lines.join('\n');
}

/** Guards the single native engine against overlapping delegations. */
let automationInFlight = false;

/** True while a device automation owns the shared engine. */
export function isNeedleAutomationRunning(): boolean {
  return automationInFlight;
}

/**
 * Runs one device-automation task on the Needle engine.
 *
 * @param instruction Self-contained instruction from the planner, e.g.
 *   "open Settings and turn on Wi-Fi".
 */
export async function runNeedleDeviceAutomation(
  instruction: string,
  options: NeedleAutomationOptions = {}
): Promise<NeedleAutomationResult> {
  const text = (instruction || '').trim();
  if (!text) {
    return { ok: false, output: 'run_device_automation needs a non-empty instruction.' };
  }

  // The swap below mutates global engine state (one llama.rn/Needle runtime).
  // Two overlapping calls either unload each other's model or share a torn
  // engine whose broadcast stream duplicates tool calls. Reject rather than
  // queue: the planner can retry, and a stale instruction is worse than a
  // clear refusal.
  if (automationInFlight) {
    return {
      ok: false,
      output: 'Another device automation is already running. Wait for it to finish before starting another.',
    };
  }
  automationInFlight = true;
  try {
    return await runAutomationTask(text, options);
  } finally {
    automationInFlight = false;
  }
}

async function runAutomationTask(
  text: string,
  options: NeedleAutomationOptions
): Promise<NeedleAutomationResult> {
  const deps = options.deps ?? {};
  const isDownloaded = deps.isModelDownloaded ?? isModelDownloaded;
  const getLoaded = deps.getLoadedModel ?? getLoadedModelName;
  const loadModel = deps.loadModel ?? ((name: string) => initializeLocalModel(true, name));
  const unloadModel = deps.unloadModel ?? unloadLocalModel;
  const hasNativeLibrary = deps.hasNativeLibrary ?? (() => NeedleModule.hasNativeLibrary());
  const runLoop =
    deps.runLoop ??
    ((prompt: string, opts: { maxSteps?: number; conversationId?: string }) =>
      runLocalAgentLoop(prompt, opts));

  // A HAVE_NEEDLE_ENGINE=0 build initializes "successfully" and answers with
  // canned JSON (device_click at a fixed coordinate, device_set_volume 5). Those
  // calls would really tap and type, so never automate on the mock stub.
  let nativeEngine = false;
  try {
    nativeEngine = Boolean(hasNativeLibrary());
  } catch {
    nativeEngine = false;
  }
  if (!nativeEngine) {
    return {
      ok: false,
      output:
        'This build has no Needle engine (mock fallback only), so on-device automation is disabled. Install a build that packages libneedle.so to use run_device_automation.',
    };
  }

  const model = await resolveNeedleAutomationModel({ ...deps, isModelDownloaded: isDownloaded, getLoadedModel: getLoaded });
  if (!model) {
    return {
      ok: false,
      output:
        'No Needle model is downloaded on this device. Download "Needle-3 (20-layer)" in Settings -> Local AI; on-device automation cannot run without it.',
    };
  }

  const planner = getLoaded();
  const alreadyOnNeedle = planner === model;

  // Planner and worker cannot share the native engine manager, so the planner
  // is parked while Needle works and reloaded afterwards.
  if (!alreadyOnNeedle) {
    await unloadModel();
    try {
      await loadModel(model);
    } catch (error: any) {
      // The planner is parked at this point. Restore it before returning, or
      // the rest of the chat turn runs with no engine at all.
      if (planner) {
        try {
          await loadModel(planner);
        } catch (restoreError: any) {
          console.warn(
            `[needleAutomation] could not restore planner model ${planner}:`,
            restoreError?.message || String(restoreError)
          );
        }
      }
      return {
        ok: false,
        model,
        output: `Could not load ${model}: ${error?.message || String(error)}`,
      };
    }
  }

  try {
    const result = await runLoop(text, {
      maxSteps: options.maxSteps,
      conversationId: options.conversationId,
    });
    return {
      ok: result.completed,
      model,
      steps: result.steps.length,
      output: formatNeedleTranscript(result),
    };
  } catch (error: any) {
    return {
      ok: false,
      model,
      output: `Device automation failed: ${error?.message || String(error)}`,
    };
  } finally {
    if (!alreadyOnNeedle) {
      try {
        await unloadModel();
      } catch {
        // best effort: a stale engine is unloaded by the next initialize()
      }
      if (planner) {
        try {
          await loadModel(planner);
        } catch (error: any) {
          console.warn(
            `[needleAutomation] could not restore planner model ${planner}:`,
            error?.message || String(error)
          );
        }
      }
    }
  }
}

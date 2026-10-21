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
  localModelStorageKey,
  unloadLocalModel,
} from './localLlm';
import { runLocalAgentLoop, type LocalAgentLoopResult } from './localAgentLoop';

/** A downloaded model counts as available when its stored path marker exists. */
async function isModelDownloaded(name: string): Promise<boolean> {
  try {
    const path = await AsyncStorage.getItem(`${localModelStorageKey(name)}_path`);
    return !!path;
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

  const deps = options.deps ?? {};
  const isDownloaded = deps.isModelDownloaded ?? isModelDownloaded;
  const getLoaded = deps.getLoadedModel ?? getLoadedModelName;
  const loadModel = deps.loadModel ?? ((name: string) => initializeLocalModel(true, name));
  const unloadModel = deps.unloadModel ?? unloadLocalModel;
  const runLoop =
    deps.runLoop ??
    ((prompt: string, opts: { maxSteps?: number; conversationId?: string }) =>
      runLocalAgentLoop(prompt, opts));

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

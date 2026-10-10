import { streamLocalLlmResponse } from './localLlm';
import { evaluateSafety } from './safetyManager';
import { executeDeviceAction, DeviceActionOutcome, DeviceActionResult } from './deviceActionExecutor';
import { db } from '../db/client';
import { operationLog } from '../db/schema';
import { generateUlid } from './syncIds';
import { stripReasoning, EMPTY_RESPONSE_ERROR_HINT } from './reasoning';
import { useConfigStore } from '../store/useConfigStore';

export interface ParsedToolCall {
  toolName: string;
  target?: string;
  value?: string;
  arguments?: Record<string, any>;
  raw: string;
  format: 'needle_json' | 'xml';
  /** Engine rationale emitted alongside the call (real envelope shape, #295). */
  reasoning?: string;
  /** Engine confidence in [0,1]; absent for the flat mock and XML shapes. */
  confidence?: number;
  /**
   * Set (with `toolName: ''`) when the engine refused to call a tool, i.e. the
   * real shape arrived with an empty `function_calls: []`. Never a tool call.
   */
  refusal?: string;
}

export interface AgentTurnStep {
  step: number;
  prompt: string;
  response: string;
  toolCall?: ParsedToolCall;
  safetyStatus?: 'success' | 'error';
  safetyMessage?: string;
  observation?: string;
  /**
   * #308: what actually happened to the device action. Distinct from
   * `safetyStatus` — safety can allow a call that then fails to execute or
   * finds no native capability at all. Absent when no action was attempted.
   */
  executionStatus?: DeviceActionOutcome | 'blocked';
  /** Recovery action performed on this step if a recovery heuristic was triggered. */
  recoveryAction?: 'wait' | 'back' | 'scroll' | 'home_reset';
}

export interface AgentTurnEvent {
  type:
    | 'token'
    | 'tool_start'
    | 'tool_executing'
    | 'tool_observation'
    | 'step_complete'
    | 'done'
    | 'error'
    | 'refusal'
    | 'recovery';
  token?: string;
  toolName?: string;
  target?: string;
  value?: string;
  observation?: string;
  step?: number;
  error?: string;
  reasoning?: string;
  confidence?: number;
  lowConfidence?: boolean;
  recoveryType?: 'wait' | 'back' | 'scroll' | 'home_reset';
}

export interface LocalAgentLoopOptions {
  conversationId?: string;
  maxSteps?: number;
  maxStepsEnabled?: boolean;
  unchangedThreshold?: number;
  waitMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  initialScreenContent?: string;
  onEvent?: (event: AgentTurnEvent) => void;
  onToken?: (token: string) => void;
}

export interface LocalAgentLoopResult {
  finalResponse: string;
  steps: AgentTurnStep[];
  totalSteps: number;
  completed: boolean;
  stoppedBySafety?: boolean;
}

import { filterAvailable } from './toolRegistry';

export const ALLOWED_DEVICE_TOOLS = new Set(
  filterAvailable('local')
    .filter((tool) => tool.name.startsWith('device_'))
    .map((tool) => tool.name)
);

/**
 * Confidence gate for local tool calls.
 *
 * PLACEHOLDER DEFAULT — the act / confirm / refuse UX is still "not yet
 * specified" on the wayfinder map (#289). This is plumbing only: calls below
 * the threshold are flagged via `lowConfidence` on the `tool_start` event and
 * are not blocked, so no product behaviour is decided here yet. The neutral
 * default is 0.5 (midpoint of the engine's [0,1] confidence head).
 */
export const LOCAL_TOOL_CALL_CONFIDENCE_THRESHOLD = 0.5;

/** Reason used when the engine refuses (`function_calls: []`) without a rationale. */
const TOOL_CALL_REFUSAL_FALLBACK = 'The model declined to call a tool (function_calls: []).';

/**
 * Parses raw text from local LLM to detect Needle JSON or XML tool calls.
 *
 * Understands both wire shapes (#295):
 *  - real engine envelope: `{type:'call', function_calls:[{name, arguments}], reasoning, confidence}`
 *  - flat mock fallback:   `{name, arguments, confidence}`
 * An envelope with an empty `function_calls: []` is a refusal, not a call.
 * The `function_calls` envelope is matched first, so it wins over any flat
 * `name` in the same object; `{type:'call'}` without a `function_calls` array
 * matches neither branch (it is not a refusal).
 * When an envelope lists several calls only the first is used (multi-call
 * dispatch is out of scope for #295).
 */
export function parseToolCall(text: string): ParsedToolCall | null {
  if (!text) return null;

  // 1. Check Needle JSON syntax: find '{' and balance matching '}'
  const startIdx = text.indexOf('{');
  if (startIdx !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            const candidate = text.substring(startIdx, i + 1);
            try {
              const parsed = JSON.parse(candidate);

              // Real engine envelope takes precedence over a flat `name` in the
              // same object (#295 F3): an adversarial/legacy
              // `{name:'device_click', function_calls:[]}` must refuse, not run.
              // Only an explicit `function_calls` array can be a call or a
              // refusal — `{type:'call'}` with no array is neither.
              if (parsed && Array.isArray(parsed.function_calls)) {
                const calls: any[] = parsed.function_calls;
                const reasoning =
                  typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined;
                const confidence =
                  typeof parsed.confidence === 'number' ? parsed.confidence : undefined;

                if (calls.length === 0) {
                  return {
                    toolName: '',
                    raw: candidate,
                    format: 'needle_json',
                    refusal: reasoning?.trim() || TOOL_CALL_REFUSAL_FALLBACK,
                    reasoning,
                    confidence,
                  };
                }

                const first = calls[0];
                if (first && typeof first.name === 'string') {
                  // Re-enter the flat path so target/value mapping stays in one place.
                  const flat = parseToolCall(JSON.stringify(first));
                  if (flat) {
                    return { ...flat, raw: candidate, reasoning, confidence };
                  }
                }
              }

              // Flat mock fallback: {name, arguments, confidence}
              if (parsed && typeof parsed.name === 'string') {
                const args = parsed.arguments || {};
                let target: string | undefined;
                if (args.target) {
                  target = String(args.target);
                } else if (args.app) {
                  target = String(args.app);
                } else if (args.x !== undefined && args.y !== undefined) {
                  target = `${args.x},${args.y}`;
                }

                let value: string | undefined;
                if (args.value !== undefined) {
                  value = String(args.value);
                } else if (args.text !== undefined) {
                  value = String(args.text);
                } else if (args.query !== undefined) {
                  value = String(args.query);
                } else if (args.input !== undefined) {
                  value = String(args.input);
                }

                return {
                  toolName: parsed.name,
                  target,
                  value,
                  arguments: args,
                  raw: candidate,
                  format: 'needle_json',
                  reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
                  confidence:
                    typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
                };
              }
            } catch {
              // try next
            }
          }
        }
      }
    }
  }

  // 2. Check GGUF / LiteRT XML syntax: <call name="...">...</call>
  const xmlMatch = text.match(
    /<call\s+name=["']([^"']+)["'](?:\s+target=["']([^"']*)["'])?(?:\s+value=["']([^"']*)["'])?>([\s\S]*?)<\/call>|<call\s+name=["']([^"']+)["'](?:\s+target=["']([^"']*)["'])?(?:\s+value=["']([^"']*)["'])?\s*\/>/i
  );
  if (xmlMatch) {
    const toolName = xmlMatch[1] || xmlMatch[5];
    let target = xmlMatch[2] || xmlMatch[6];
    let value = xmlMatch[3] || xmlMatch[7];
    const body = xmlMatch[4];
    if (body) {
      const targetArg = body.match(/<arg\s+name=["']target["']>([\s\S]*?)<\/arg>/i);
      if (targetArg) target = targetArg[1].trim();
      const valueArg = body.match(/<arg\s+name=["']value["']>([\s\S]*?)<\/arg>/i);
      if (valueArg) value = valueArg[1].trim();
    }
    return {
      toolName,
      target,
      value,
      raw: xmlMatch[0],
      format: 'xml',
    };
  }

  return null;
}

/**
 * Logs a device action to SQLite operationLog for offline synchronization.
 *
 * `status` is the real outcome (#308): `executed` only when the action really
 * ran; `failed`/`unavailable` when it did not; `simulated` for mock mode;
 * `blocked` when safety stopped it before execution.
 */
async function logDeviceStepToDb(
  conversationId: string,
  step: number,
  toolCall: ParsedToolCall,
  observation: string,
  status: DeviceActionOutcome | 'blocked'
): Promise<void> {
  if (!db) return;
  try {
    const payload = JSON.stringify({
      step,
      toolName: toolCall.toolName,
      target: toolCall.target,
      value: toolCall.value,
      arguments: toolCall.arguments,
      observation,
      status,
      timestamp: Date.now(),
    });

    await db.insert(operationLog).values({
      // T5 (#253): ULID so the id stays monotonic in the server's ULID cursor
      // space even if the row ever lands in `sync_messages` with a pull-visible
      // provider. (Device steps also carry provider android_client, which
      // sync_pull already excludes — belt and braces, see utils/syncIds.ts.)
      id: generateUlid(),
      type: 'device_step',
      conversation_id: conversationId,
      payload,
      created_at: Date.now(),
    });
  } catch (err) {
    console.warn('[localAgentLoop] Failed to log device step to operationLog:', err);
  }
}

/**
 * Recovery heuristic definitions and configuration.
 */
export type RecoveryActionType = 'wait' | 'back' | 'scroll_and_retap' | 'home_reset';

export interface RecoveryContext {
  screenContent: string;
  target?: string;
  toolName?: string;
  consecutiveUnchangedCount: number;
  unchangedThreshold?: number;
  lastRecoveryAction?: 'back' | 'home_reset' | null;
}

export type RecoveryAction =
  | { type: 'wait'; reason: string }
  | { type: 'back'; reason: string }
  | { type: 'scroll_and_retap'; target: string; reason: string }
  | { type: 'home_reset'; reason: string }
  | null;

export const DEFAULT_UNCHANGED_HIERARCHY_THRESHOLD = 3;
export const DEFAULT_MAX_STEPS = 15;

/**
 * Bound total waits across an entire agent loop run to guarantee termination
 * even if loading indicators pathologically persist or oscillate.
 */
export const MAX_TOTAL_RECOVERY_WAITS = 10;

/**
 * Canonical loading indicator patterns matched by isScreenLoading and cleared by clearLoadingMarkers.
 */
export const LOADING_MARKERS: readonly string[] = [
  'circularprogressindicator',
  'progressbar',
  'progress_bar',
  'loading_spinner',
  'loading...',
  'text="loading..."',
  'text="loading"',
  'desc="loading"',
  'state="loading"',
  'is_loading',
  'loading',
];

/**
 * Detects if the screen content or observation contains a loading indicator.
 * Pure function: matches progress bars, spinners, and loading text.
 */
export function isScreenLoading(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return LOADING_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Clears loading markers from content using the exact same patterns detected by isScreenLoading.
 * Pure function: strips circular progress indicators, progress bars, spinners, and loading text.
 */
export function clearLoadingMarkers(content: string): string {
  if (!content) return '';
  let result = content;
  const sortedMarkers = [...LOADING_MARKERS].sort((a, b) => b.length - a.length);
  for (const marker of sortedMarkers) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '');
  }
  return result;
}

/**
 * Detects if the software keyboard (GBoard or LatinIME) is blocking the target.
 * Pure function: checks for keyboard indicators and target obscuration.
 */
export function isKeyboardBlocking(content: string, target?: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  const hasKeyboard =
    lower.includes('com.google.android.inputmethod.latin') ||
    lower.includes('gboard') ||
    lower.includes('latinime') ||
    lower.includes('inputmethod') ||
    lower.includes('softkeyboard') ||
    lower.includes('keyboard is blocking') ||
    lower.includes('blocked by keyboard');

  if (!hasKeyboard) return false;

  if (target) {
    const targetLower = target.toLowerCase();
    if (lower.includes(`blocking ${targetLower}`) || lower.includes(`blocked by keyboard`)) {
      return true;
    }
  }

  return (
    lower.includes('keyboard is blocking') ||
    lower.includes('blocked by keyboard') ||
    lower.includes('gboard is blocking')
  );
}

/**
 * Detects if a tap/click target is located off-screen within a scrollable container.
 * Pure function: inspects scrollable container markers and off-screen bounds/keywords.
 */
export function isTargetOffScreenScrollable(content: string, target?: string): boolean {
  if (!content || !target) return false;
  const lower = content.toLowerCase();

  const isScrollable =
    lower.includes('scrollable') ||
    lower.includes('scrollview') ||
    lower.includes('recyclerview') ||
    lower.includes('listview');

  if (!isScrollable) return false;

  if (
    lower.includes('off-screen') ||
    lower.includes('offscreen') ||
    lower.includes('outside viewport') ||
    lower.includes('scroll to reveal') ||
    lower.includes('scroll to bring into view')
  ) {
    return true;
  }

  const targetIdx = content.indexOf(target);
  if (targetIdx !== -1) {
    const snippet = content.slice(targetIdx, targetIdx + 150);
    const boundsMatch = snippet.match(/bounds=\[(\d+),(-?\d+),(\d+),(-?\d+)\]/);
    if (boundsMatch) {
      const topPct = parseInt(boundsMatch[2], 10);
      const bottomPct = parseInt(boundsMatch[4], 10);
      if (topPct >= 100 || bottomPct <= 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detects whether an observation is a real screen hierarchy snapshot.
 * Pure function: matches accessibility tree nodes, bounds, hierarchy headers,
 * scrollable containers, and package indicators.
 * Simple tool execution outputs (e.g. "Success", "Action failed", or error strings)
 * are not screen snapshots and must not poison the unchanged hierarchy counter.
 */
export function isScreenSnapshot(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return (
    lower.includes('bounds=') ||
    lower.includes('hierarchy') ||
    lower.includes('screen tree') ||
    lower.includes('scrollable') ||
    lower.includes('package') ||
    /\[@e\d+\]/.test(content) ||
    lower.includes('node:') ||
    lower.includes('linearlayout') ||
    lower.includes('framelayout') ||
    lower.includes('recyclerview') ||
    lower.includes('scrollview')
  );
}

/**
 * Derives a stable comparison signature from a screen hierarchy snapshot.
 * One-line choice: We normalize whitespace, dynamic timestamps, and volatile pixel coords to track stagnant screens.
 */
export function getHierarchySignature(content: string): string {
  if (!content) return '';
  return content
    .replace(/\b\d{10,13}\b/g, '') // strip timestamps
    .replace(/px\(-?\d+,-?\d+,-?\d+,-?\d+\)/g, '') // strip volatile pixel bounds
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether the current hierarchy snapshot matches the previous one.
 * Pure function comparison.
 */
export function isHierarchyUnchanged(previousSignature: string, currentSignature: string): boolean {
  if (!previousSignature || !currentSignature) return false;
  return previousSignature === currentSignature;
}

/**
 * Evaluates recovery heuristics against current screen state and action context.
 * Pure function: maps failure/obstruction triggers to recovery actions.
 */
export function detectRecoveryAction(context: RecoveryContext): RecoveryAction {
  const {
    screenContent,
    target,
    toolName,
    consecutiveUnchangedCount,
    unchangedThreshold = DEFAULT_UNCHANGED_HIERARCHY_THRESHOLD,
    lastRecoveryAction,
  } = context;

  // No recovery heuristics may trigger before at least one screen observation arrives
  if (!screenContent || !screenContent.trim()) {
    return null;
  }

  // 1. Screen hierarchy unchanged N times in a row -> back, and if still unchanged, home reset
  if (consecutiveUnchangedCount >= unchangedThreshold) {
    if (lastRecoveryAction === 'back') {
      return {
        type: 'home_reset',
        reason: `Screen hierarchy unchanged ${consecutiveUnchangedCount} times; back did not resolve, triggering home reset.`,
      };
    }
    return {
      type: 'back',
      reason: `Screen hierarchy unchanged ${consecutiveUnchangedCount} times in a row; triggering back to recover.`,
    };
  }

  // 2. Screen shows a loading indicator -> wait
  if (isScreenLoading(screenContent)) {
    return {
      type: 'wait',
      reason: 'Screen shows a loading indicator; waiting for UI to settle.',
    };
  }

  // 3. Keyboard / GBoard is blocking the target -> back
  if (isKeyboardBlocking(screenContent, target)) {
    return {
      type: 'back',
      reason: `Keyboard is blocking target "${target || ''}"; pressing back to dismiss.`,
    };
  }

  // 4. Tap target off-screen inside a scrollable container -> scroll to bring into view, then re-tap
  const isTap = toolName === 'device_click' || toolName === 'device_tap';
  if (isTap && target && isTargetOffScreenScrollable(screenContent, target)) {
    return {
      type: 'scroll_and_retap',
      target,
      reason: `Target "${target}" is off-screen inside a scrollable container; scrolling to bring into view.`,
    };
  }

  return null;
}

/**
 * Executes a multi-turn streaming local agent loop with safety gating and on-device execution.
 * Configurable maxSteps (default 15, disableable) with automatic recovery heuristics.
 *
 * Recovery Counting Rule:
 * - Active tool actions and corrective recovery operations (back, scroll, home reset)
 *   advance the step counter and count against `maxSteps`.
 * - Pure wait recovery actions (triggered when the screen shows a loading indicator)
 *   do NOT increment the step counter and do NOT consume the `maxSteps` budget.
 */
export async function runLocalAgentLoop(
  initialPrompt: string,
  options: LocalAgentLoopOptions = {}
): Promise<LocalAgentLoopResult> {
  const config = useConfigStore?.getState ? useConfigStore.getState() : ({} as any);
  const maxStepsEnabled = options.maxStepsEnabled ?? config.maxStepsEnabled ?? true;
  const configuredMaxSteps = options.maxSteps ?? config.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxSteps = maxStepsEnabled ? configuredMaxSteps : Infinity;
  const unchangedThreshold = options.unchangedThreshold ?? DEFAULT_UNCHANGED_HIERARCHY_THRESHOLD;
  const waitMs = options.waitMs ?? 500;
  const sleepFn = options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const conversationId = options.conversationId || 'default_local_conv';
  const steps: AgentTurnStep[] = [];

  let currentPrompt = initialPrompt;
  let step = 1;
  let completed = false;
  let finalResponse = '';

  let lastScreenContent = options.initialScreenContent ?? '';
  let previousHierarchySignature = '';
  let consecutiveUnchangedCount = 0;
  let lastRecoveryAction: 'back' | 'home_reset' | null = null;
  let consecutiveWaitCount = 0;
  let totalWaitCount = 0;

  while (step <= maxSteps) {
    let stepResponse = '';
    const tokenBuffer: string[] = [];

    const generator = streamLocalLlmResponse(currentPrompt, (token: string) => {
      tokenBuffer.push(token);
      options.onToken?.(token);
      options.onEvent?.({
        type: 'token',
        token,
        step,
      });
    });

    for await (const chunk of generator) {
      stepResponse += chunk;
    }

    const toolCall = parseToolCall(stepResponse);

    if (!toolCall) {
      // Normal conversational completion, no further tool steps needed
      const strippedResponse = stripReasoning(stepResponse, false).trim();
      const cleanedResponse = strippedResponse || EMPTY_RESPONSE_ERROR_HINT;
      steps.push({
        step,
        prompt: currentPrompt,
        response: cleanedResponse,
      });
      finalResponse = cleanedResponse;
      completed = true;
      options.onEvent?.({
        type: 'done',
        step,
      });
      break;
    }

    // #295: the engine refused to call a tool (empty function_calls). No tool is
    // executed, no name is fabricated — the turn ends with an explicit refusal.
    if (toolCall.refusal) {
      steps.push({
        step,
        prompt: currentPrompt,
        response: stepResponse,
        toolCall,
        observation: toolCall.refusal,
      });
      finalResponse = stepResponse;
      completed = true;
      options.onEvent?.({
        type: 'refusal',
        observation: toolCall.refusal,
        reasoning: toolCall.reasoning,
        confidence: toolCall.confidence,
        step,
      });
      options.onEvent?.({
        type: 'done',
        step,
      });
      break;
    }

    // Extract thoughts / rationale preceding the tool call
    const rawIdx = stepResponse.indexOf(toolCall.raw);
    const thoughts = rawIdx > 0 ? stepResponse.slice(0, rawIdx).trim() : undefined;

    // Tool detected in model response
    options.onEvent?.({
      type: 'tool_start',
      toolName: toolCall.toolName,
      target: toolCall.target,
      value: toolCall.value,
      reasoning: toolCall.reasoning,
      confidence: toolCall.confidence,
      // Flag only: the act/confirm/refuse UX (#289) is not decided yet, so a
      // below-threshold call still runs exactly as before.
      lowConfidence:
        toolCall.confidence !== undefined &&
        toolCall.confidence < LOCAL_TOOL_CALL_CONFIDENCE_THRESHOLD,
      step,
    });

    // Evaluate recovery heuristics
    const recovery = detectRecoveryAction({
      screenContent: lastScreenContent,
      target: toolCall.target,
      toolName: toolCall.toolName,
      consecutiveUnchangedCount,
      unchangedThreshold,
      lastRecoveryAction,
    });

    if (recovery?.type === 'wait') {
      if (totalWaitCount >= MAX_TOTAL_RECOVERY_WAITS) {
        finalResponse = stepResponse;
        completed = false;
        break;
      }
      totalWaitCount++;
      consecutiveWaitCount++;
      const observation = `[Recovery] ${recovery.reason}`;
      options.onEvent?.({
        type: 'recovery',
        recoveryType: 'wait',
        observation,
        step,
      });
      await sleepFn(waitMs);
      steps.push({
        step,
        prompt: currentPrompt,
        response: stepResponse,
        observation,
        recoveryAction: 'wait',
      });
      currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
      lastScreenContent = clearLoadingMarkers(lastScreenContent);
      if (consecutiveWaitCount >= 3) {
        lastScreenContent = '';
      }
      // Note: step is NOT incremented; pure wait does not consume maxSteps budget
      continue;
    }

    // Reset consecutive wait counter whenever screen is no longer in wait recovery
    consecutiveWaitCount = 0;

    if (recovery?.type === 'back') {
      const isUnchangedRecovery = consecutiveUnchangedCount >= unchangedThreshold;
      if (isUnchangedRecovery) {
        lastRecoveryAction = 'back';
        consecutiveUnchangedCount = 0;
      }
      const recoveryToolCall: ParsedToolCall = {
        toolName: 'device_press_key',
        target: 'BACK',
        raw: 'device_press_key BACK',
        format: 'needle_json',
      };
      const safety = await evaluateSafety(
        'device_press_key',
        'BACK',
        undefined,
        thoughts,
        conversationId
      );

      if (safety.status === 'error') {
        const observation = `Action blocked by safety policy: ${safety.result}`;
        await logDeviceStepToDb(conversationId, step, recoveryToolCall, observation, 'blocked');
        options.onEvent?.({
          type: 'tool_observation',
          toolName: 'device_press_key',
          observation,
          step,
          error: safety.result,
        });
        steps.push({
          step,
          prompt: currentPrompt,
          response: stepResponse,
          toolCall: recoveryToolCall,
          safetyStatus: 'error',
          safetyMessage: safety.result,
          observation,
          executionStatus: 'blocked',
          recoveryAction: 'back',
        });
        currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
        if (maxStepsEnabled && step >= maxSteps) {
          finalResponse = stepResponse;
          completed = false;
          break;
        }
        step++;
        continue;
      }

      const observation = `[Recovery] ${recovery.reason}`;
      options.onEvent?.({
        type: 'recovery',
        recoveryType: 'back',
        observation,
        step,
      });
      const backOutcome = await executeDeviceAction('device_press_key', 'BACK');
      await logDeviceStepToDb(conversationId, step, recoveryToolCall, observation, backOutcome.outcome);
      steps.push({
        step,
        prompt: currentPrompt,
        response: stepResponse,
        observation,
        recoveryAction: 'back',
        executionStatus: backOutcome.outcome,
      });
      currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
      lastScreenContent = lastScreenContent
        .replace(/latinime/gi, '')
        .replace(/gboard/gi, '')
        .replace(/keyboard/gi, '');
      if (maxStepsEnabled && step >= maxSteps) {
        finalResponse = stepResponse;
        completed = false;
        break;
      }
      step++;
      continue;
    }

    if (recovery?.type === 'home_reset') {
      lastRecoveryAction = 'home_reset';
      consecutiveUnchangedCount = 0;
      const recoveryToolCall: ParsedToolCall = {
        toolName: 'device_press_key',
        target: 'HOME',
        raw: 'device_press_key HOME',
        format: 'needle_json',
      };
      const safety = await evaluateSafety(
        'device_press_key',
        'HOME',
        undefined,
        thoughts,
        conversationId
      );

      if (safety.status === 'error') {
        const observation = `Action blocked by safety policy: ${safety.result}`;
        await logDeviceStepToDb(conversationId, step, recoveryToolCall, observation, 'blocked');
        options.onEvent?.({
          type: 'tool_observation',
          toolName: 'device_press_key',
          observation,
          step,
          error: safety.result,
        });
        steps.push({
          step,
          prompt: currentPrompt,
          response: stepResponse,
          toolCall: recoveryToolCall,
          safetyStatus: 'error',
          safetyMessage: safety.result,
          observation,
          executionStatus: 'blocked',
          recoveryAction: 'home_reset',
        });
        currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
        if (maxStepsEnabled && step >= maxSteps) {
          finalResponse = stepResponse;
          completed = false;
          break;
        }
        step++;
        continue;
      }

      const observation = `[Recovery] ${recovery.reason}`;
      options.onEvent?.({
        type: 'recovery',
        recoveryType: 'home_reset',
        observation,
        step,
      });
      const homeOutcome = await executeDeviceAction('device_press_key', 'HOME');
      await logDeviceStepToDb(conversationId, step, recoveryToolCall, observation, homeOutcome.outcome);
      steps.push({
        step,
        prompt: currentPrompt,
        response: stepResponse,
        observation,
        recoveryAction: 'home_reset',
        executionStatus: homeOutcome.outcome,
      });
      currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
      if (maxStepsEnabled && step >= maxSteps) {
        finalResponse = stepResponse;
        completed = false;
        break;
      }
      step++;
      continue;
    }

    if (recovery?.type === 'scroll_and_retap') {
      // 1. Safety check on the original tool call first
      const safety = await evaluateSafety(
        toolCall.toolName,
        recovery.target,
        toolCall.value,
        thoughts,
        conversationId
      );

      if (safety.status === 'error') {
        const observation = `Action blocked by safety policy: ${safety.result}`;
        await logDeviceStepToDb(conversationId, step, toolCall, observation, 'blocked');
        options.onEvent?.({
          type: 'tool_observation',
          toolName: toolCall.toolName,
          observation,
          step,
          error: safety.result,
        });
        steps.push({
          step,
          prompt: currentPrompt,
          response: stepResponse,
          toolCall,
          safetyStatus: 'error',
          safetyMessage: safety.result,
          observation,
          executionStatus: 'blocked',
        });
        currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
        if (maxStepsEnabled && step >= maxSteps) {
          finalResponse = stepResponse;
          completed = false;
          break;
        }
        step++;
        continue;
      }

      // 2. Safety check on the scroll action
      const scrollSafety = await evaluateSafety(
        'device_scroll',
        recovery.target,
        'down',
        thoughts,
        conversationId
      );
      const scrollToolCall: ParsedToolCall = {
        toolName: 'device_scroll',
        target: recovery.target,
        value: 'down',
        raw: '',
        format: 'needle_json',
      };

      if (scrollSafety.status === 'error') {
        const observation = `Action blocked by safety policy: ${scrollSafety.result}`;
        await logDeviceStepToDb(conversationId, step, scrollToolCall, observation, 'blocked');
        options.onEvent?.({
          type: 'tool_observation',
          toolName: 'device_scroll',
          observation,
          step,
          error: scrollSafety.result,
        });
        steps.push({
          step,
          prompt: currentPrompt,
          response: stepResponse,
          toolCall: scrollToolCall,
          safetyStatus: 'error',
          safetyMessage: scrollSafety.result,
          observation,
          executionStatus: 'blocked',
        });
        currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
        if (maxStepsEnabled && step >= maxSteps) {
          finalResponse = stepResponse;
          completed = false;
          break;
        }
        step++;
        continue;
      }

      const observation = `[Recovery] ${recovery.reason}`;
      options.onEvent?.({
        type: 'recovery',
        recoveryType: 'scroll',
        target: recovery.target,
        observation,
        step,
      });
      const scrollOutcome = await executeDeviceAction('device_scroll', recovery.target, 'down');
      await logDeviceStepToDb(conversationId, step, scrollToolCall, scrollOutcome.observation, scrollOutcome.outcome);

      const retapOutcome = await executeDeviceAction(toolCall.toolName, recovery.target, toolCall.value);
      const fullObservation = `[Recovery] Scrolled target into view and retapped. Result: ${retapOutcome.observation}`;
      await logDeviceStepToDb(conversationId, step, toolCall, fullObservation, retapOutcome.outcome);

      steps.push({
        step,
        prompt: currentPrompt,
        response: stepResponse,
        toolCall,
        observation: fullObservation,
        recoveryAction: 'scroll',
        executionStatus: retapOutcome.outcome,
      });
      currentPrompt += `\n${stepResponse}\nObservation: ${fullObservation}\n`;
      if (isScreenSnapshot(retapOutcome.observation)) {
        lastScreenContent = retapOutcome.observation;
      }
      if (maxStepsEnabled && step >= maxSteps) {
        finalResponse = stepResponse;
        completed = false;
        break;
      }
      step++;
      continue;
    }

    if (!ALLOWED_DEVICE_TOOLS.has(toolCall.toolName)) {
      const observation = `Error: Unknown device tool "${toolCall.toolName}".`;
      steps.push({
        step,
        prompt: currentPrompt,
        response: stepResponse,
        toolCall,
        safetyStatus: 'error',
        safetyMessage: observation,
        observation,
      });
      options.onEvent?.({
        type: 'tool_observation',
        toolName: toolCall.toolName,
        observation,
        step,
        error: observation,
      });
      currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
      if (maxStepsEnabled && step >= maxSteps) {
        finalResponse = stepResponse;
        completed = false;
        break;
      }
      step++;
      continue;
    }

    // 1. Check safety policy
    const safety = await evaluateSafety(
      toolCall.toolName,
      toolCall.target,
      toolCall.value,
      thoughts,
      conversationId
    );

    let observation: string;
    let safetyStatus: 'success' | 'error';
    let safetyMessage: string | undefined;
    let executionStatus: DeviceActionOutcome | 'blocked' | undefined;

    if (safety.status === 'error') {
      safetyStatus = 'error';
      safetyMessage = safety.result;
      observation = `Action blocked by safety policy: ${safety.result}`;

      executionStatus = 'blocked';
      await logDeviceStepToDb(conversationId, step, toolCall, observation, 'blocked');

      options.onEvent?.({
        type: 'tool_observation',
        toolName: toolCall.toolName,
        observation,
        step,
        error: safety.result,
      });
    } else {
      safetyStatus = 'success';
      options.onEvent?.({
        type: 'tool_executing',
        toolName: toolCall.toolName,
        target: toolCall.target,
        value: toolCall.value,
        step,
      });

      // 2. Execute device action. #308: the executor reports what actually
      // happened. An unavailable or failed action is recorded and fed back as
      // "did not execute" — never as a success, and never silently.
      let action: DeviceActionResult;
      try {
        action = await executeDeviceAction(
          toolCall.toolName,
          toolCall.target,
          toolCall.value
        );
      } catch (err: any) {
        action = {
          outcome: 'failed',
          observation: `Execution error: ${err?.message || String(err)}`,
        };
      }
      observation = action.observation;
      executionStatus = action.outcome;

      await logDeviceStepToDb(conversationId, step, toolCall, observation, action.outcome);

      options.onEvent?.({
        type: 'tool_observation',
        toolName: toolCall.toolName,
        observation,
        step,
        ...(action.outcome !== 'executed' && action.outcome !== 'simulated'
          ? { error: observation }
          : {}),
      });
    }

    steps.push({
      step,
      prompt: currentPrompt,
      response: stepResponse,
      toolCall,
      safetyStatus,
      safetyMessage,
      observation,
      executionStatus,
    });

    options.onEvent?.({
      type: 'step_complete',
      step,
    });

    // Update screen content and unchanged hierarchy counter ONLY when observation is a screen snapshot
    if (isScreenSnapshot(observation)) {
      lastScreenContent = observation;
      const currentSignature = getHierarchySignature(observation);
      if (previousHierarchySignature && isHierarchyUnchanged(previousHierarchySignature, currentSignature)) {
        consecutiveUnchangedCount++;
      } else if (currentSignature) {
        consecutiveUnchangedCount = 0;
        previousHierarchySignature = currentSignature;
        lastRecoveryAction = null;
      }
    }

    if (maxStepsEnabled && step >= maxSteps) {
      finalResponse = stepResponse;
      completed = false; // hit max step limit
      break;
    }

    // 3. Inject observation back into local model context for next step
    currentPrompt += `\n${stepResponse}\nObservation: ${observation}\n`;
    step++;
  }

  return {
    finalResponse: finalResponse || steps[steps.length - 1]?.response || '',
    steps,
    totalSteps: steps.length,
    completed,
  };
}

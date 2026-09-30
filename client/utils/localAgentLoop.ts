import { streamLocalLlmResponse } from './localLlm';
import { evaluateSafety } from './safetyManager';
import { executeDeviceAction, DeviceActionOutcome, DeviceActionResult } from './deviceActionExecutor';
import { db } from '../db/client';
import { operationLog } from '../db/schema';
import { generateUlid } from './syncIds';

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
}

export interface AgentTurnEvent {
  type: 'token' | 'tool_start' | 'tool_executing' | 'tool_observation' | 'step_complete' | 'done' | 'error' | 'refusal';
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
}

export interface LocalAgentLoopOptions {
  conversationId?: string;
  maxSteps?: number;
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

export const ALLOWED_DEVICE_TOOLS = new Set([
  'device_screen_read',
  'device_info',
  'device_screenshot',
  'device_click',
  'device_type',
  'device_scroll',
  'device_swipe',
  'device_press_key',
  'device_set_volume',
  'device_open_app',
]);

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
 * Executes a multi-turn streaming local agent loop with safety gating and on-device execution.
 * Max 5 steps per invocation.
 */
export async function runLocalAgentLoop(
  initialPrompt: string,
  options: LocalAgentLoopOptions = {}
): Promise<LocalAgentLoopResult> {
  const maxSteps = Math.min(options.maxSteps || 5, 5);
  const conversationId = options.conversationId || 'default_local_conv';
  const steps: AgentTurnStep[] = [];

  let currentPrompt = initialPrompt;
  let step = 1;
  let completed = false;
  let finalResponse = '';

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
      steps.push({
        step,
        prompt: currentPrompt,
        response: stepResponse,
      });
      finalResponse = stepResponse;
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
      step++;
      continue;
    }

    // Extract thoughts / rationale preceding the tool call
    const rawIdx = stepResponse.indexOf(toolCall.raw);
    const thoughts = rawIdx > 0 ? stepResponse.slice(0, rawIdx).trim() : undefined;

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
        ...(action.outcome === 'failed' || action.outcome === 'unavailable'
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

    if (step >= maxSteps) {
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

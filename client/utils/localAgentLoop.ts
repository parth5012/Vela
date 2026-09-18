import { streamLocalLlmResponse } from './localLlm';
import { evaluateSafety } from './safetyManager';
import { executeDeviceAction } from './deviceActionExecutor';
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
}

export interface AgentTurnStep {
  step: number;
  prompt: string;
  response: string;
  toolCall?: ParsedToolCall;
  safetyStatus?: 'success' | 'error';
  safetyMessage?: string;
  observation?: string;
}

export interface AgentTurnEvent {
  type: 'token' | 'tool_start' | 'tool_executing' | 'tool_observation' | 'step_complete' | 'done' | 'error';
  token?: string;
  toolName?: string;
  target?: string;
  value?: string;
  observation?: string;
  step?: number;
  error?: string;
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
 * Parses raw text from local LLM to detect Needle JSON or XML tool calls.
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
 * Logs an executed or blocked device action to SQLite operationLog for offline synchronization.
 */
async function logDeviceStepToDb(
  conversationId: string,
  step: number,
  toolCall: ParsedToolCall,
  observation: string,
  status: 'executed' | 'blocked'
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

    // Tool detected in model response
    options.onEvent?.({
      type: 'tool_start',
      toolName: toolCall.toolName,
      target: toolCall.target,
      value: toolCall.value,
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

    if (safety.status === 'error') {
      safetyStatus = 'error';
      safetyMessage = safety.result;
      observation = `Action blocked by safety policy: ${safety.result}`;

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

      // 2. Execute device action
      try {
        observation = await executeDeviceAction(
          toolCall.toolName,
          toolCall.target,
          toolCall.value
        );
      } catch (err: any) {
        observation = `Execution error: ${err?.message || String(err)}`;
      }

      await logDeviceStepToDb(conversationId, step, toolCall, observation, 'executed');

      options.onEvent?.({
        type: 'tool_observation',
        toolName: toolCall.toolName,
        observation,
        step,
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

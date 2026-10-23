/**
 * On-Device Tool-Calling Bridge with Security Consent Gates (WF-07 / #416)
 *
 * Implements tool schemas for WF-01 approved capabilities (Alarms, Calendar, Messages, Clipboard),
 * local tool call parser (JSON, Markdown code blocks, <tool_call> tags),
 * security consent gate (user-visible confirmation dialog, deny-by-default for mutating actions),
 * execution dispatch with fake/mock executor registry support,
 * and a hard cap of maximum 3 tool calls per conversation turn.
 *
 * Respects WF-01 product decisions in DECISIONS.md.
 */

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  required?: boolean;
}

export interface OnDeviceToolSchema {
  name: string;
  description: string;
  isMutating: boolean;
  parameters: Record<string, ToolParameterSchema>;
}

export const ON_DEVICE_TOOL_SCHEMAS: OnDeviceToolSchema[] = [
  // Alarms
  {
    name: 'get_alarms',
    description: 'Lists currently configured alarms on the device.',
    isMutating: false,
    parameters: {},
  },
  {
    name: 'set_alarm',
    description: 'Sets a new alarm on the device for a specified time and label.',
    isMutating: true,
    parameters: {
      hour: { type: 'number', description: 'Hour of the day in 24-hour format (0-23)', required: true },
      minute: { type: 'number', description: 'Minute of the hour (0-59)', required: true },
      label: { type: 'string', description: 'Descriptive title or label for the alarm', required: false },
      days: { type: 'array', description: 'Array of days of week (1=Monday ... 7=Sunday)', required: false },
    },
  },

  // Calendar
  {
    name: 'get_calendar_events',
    description: 'Queries calendar events for a specific date range.',
    isMutating: false,
    parameters: {
      start_date: { type: 'string', description: 'Start date in ISO format (YYYY-MM-DD)', required: true },
      end_date: { type: 'string', description: 'End date in ISO format (YYYY-MM-DD)', required: false },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Creates a new event or appointment on the device calendar.',
    isMutating: true,
    parameters: {
      title: { type: 'string', description: 'Title or summary of the event', required: true },
      start_time: { type: 'string', description: 'Start time in ISO format', required: true },
      end_time: { type: 'string', description: 'End time in ISO format', required: true },
      description: { type: 'string', description: 'Optional details or notes', required: false },
    },
  },

  // Messages
  {
    name: 'get_recent_messages',
    description: 'Fetches recent SMS or messaging threads from the device.',
    isMutating: false,
    parameters: {
      count: { type: 'number', description: 'Maximum number of messages to fetch', required: false },
      sender: { type: 'string', description: 'Filter messages from specific sender/number', required: false },
    },
  },
  {
    name: 'send_message',
    description: 'Drafts and sends a message to a recipient.',
    isMutating: true,
    parameters: {
      recipient: { type: 'string', description: 'Phone number or contact name', required: true },
      message_text: { type: 'string', description: 'Body text of the message to send', required: true },
    },
  },

  // Clipboard
  {
    name: 'read_clipboard',
    description: 'Reads the current plain text string stored in the system clipboard.',
    isMutating: false,
    parameters: {},
  },
  {
    name: 'write_clipboard',
    description: 'Writes a string to the system clipboard.',
    isMutating: true,
    parameters: {
      text: { type: 'string', description: 'Text to copy to clipboard', required: true },
    },
  },
];

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolExecutionResult {
  status: 'success' | 'denied' | 'error' | 'limit_exceeded';
  result?: any;
  error?: string;
}

export type ConsentGateHandler = (
  toolCall: ToolCallRequest
) => Promise<{ approved: boolean; reason?: string }>;

export type ToolExecutorRegistry = Record<
  string,
  (args: any) => Promise<any>
>;

export interface OnDeviceToolBridgeOptions {
  consentGate?: ConsentGateHandler;
  executors?: ToolExecutorRegistry;
  maxCallsPerTurn?: number;
}

export class OnDeviceToolBridge {
  private consentGate?: ConsentGateHandler;
  private executors: ToolExecutorRegistry;
  private maxCallsPerTurn: number;
  private currentTurnCalls: number = 0;

  constructor(options: OnDeviceToolBridgeOptions = {}) {
    this.consentGate = options.consentGate;
    this.executors = options.executors || {};
    this.maxCallsPerTurn = options.maxCallsPerTurn ?? 3;
  }

  /**
   * Resets turn-level execution counters. Must be called at the start of each user turn.
   */
  startNewTurn(): void {
    this.currentTurnCalls = 0;
  }

  getTurnCallCount(): number {
    return this.currentTurnCalls;
  }

  /**
   * Parses model generation output for tool calls across common formats:
   * 1. XML tags: `<tool_call>{...}</tool_call>`
   * 2. Markdown code blocks: ````json {...} ````
   * 3. Raw JSON objects: `{"name": "...", "arguments": {...}}`
   */
  parseToolCall(text: string): ToolCallRequest | null {
    if (!text || typeof text !== 'string') return null;

    const trimmed = text.trim();

    // 1. Check XML tag <tool_call>...</tool_call>
    const xmlMatch = trimmed.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
    if (xmlMatch && xmlMatch[1]) {
      try {
        const parsed = JSON.parse(xmlMatch[1].trim());
        if (parsed && typeof parsed.name === 'string') {
          return {
            name: parsed.name,
            arguments: parsed.arguments || parsed.parameters || {},
          };
        }
      } catch {}
    }

    // 2. Check Markdown code blocks: ```json ... ``` or ``` ... ```
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (parsed && typeof parsed.name === 'string') {
          return {
            name: parsed.name,
            arguments: parsed.arguments || parsed.parameters || {},
          };
        }
      } catch {}
    }

    // 3. Check raw JSON
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.name === 'string') {
          return {
            name: parsed.name,
            arguments: parsed.arguments || parsed.parameters || {},
          };
        }
      } catch {}
    }

    return null;
  }

  /**
   * Evaluates safety requirements and executes the requested tool call.
   */
  async executeToolCall(toolCall: ToolCallRequest): Promise<ToolExecutionResult> {
    // 1. Enforce hard cap (max 3 calls per turn)
    if (this.currentTurnCalls >= this.maxCallsPerTurn) {
      console.warn(
        `[OnDeviceToolBridge] Hard cap reached: ${this.currentTurnCalls}/${this.maxCallsPerTurn} tool calls in this turn`
      );
      return {
        status: 'limit_exceeded',
        error: `Tool execution limit exceeded: maximum ${this.maxCallsPerTurn} tool calls permitted per turn`,
      };
    }

    // Find tool definition
    const schema = ON_DEVICE_TOOL_SCHEMAS.find((s) => s.name === toolCall.name);
    if (!schema) {
      return {
        status: 'error',
        error: `Unknown on-device tool: '${toolCall.name}'`,
      };
    }

    // 2. Security Consent Gate for Mutating Actions
    if (schema.isMutating) {
      if (this.consentGate) {
        const consent = await this.consentGate(toolCall);
        if (!consent.approved) {
          console.warn(
            `[OnDeviceToolBridge] User denied consent for mutating action: ${toolCall.name}`
          );
          return {
            status: 'denied',
            error: `Action denied by user consent gate: ${consent.reason || 'User cancelled'}`,
          };
        }
      } else {
        // Deny by default if consent gate is required but not configured
        console.warn(
          `[OnDeviceToolBridge] Deny-by-default: mutating action ${toolCall.name} has no consent gate configured`
        );
        return {
          status: 'denied',
          error: 'Action denied by user consent gate (no confirmation gate active)',
        };
      }
    }

    // 3. Execute Tool
    this.currentTurnCalls++;

    const executor = this.executors[toolCall.name];
    if (!executor) {
      console.warn(`[OnDeviceToolBridge] No executor registered for ${toolCall.name}, using simulated mock`);
      return {
        status: 'success',
        result: {
          simulated: true,
          tool: toolCall.name,
          args: toolCall.arguments,
        },
      };
    }

    try {
      const output = await executor(toolCall.arguments);
      return {
        status: 'success',
        result: output,
      };
    } catch (err: any) {
      console.error(`[OnDeviceToolBridge] Execution failed for ${toolCall.name}:`, err);
      return {
        status: 'error',
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Formats tool execution result into context for model continuation.
   */
  formatToolResultForContext(
    toolCall: ToolCallRequest,
    executionResult: ToolExecutionResult
  ): string {
    const payload = {
      tool: toolCall.name,
      status: executionResult.status,
      result: executionResult.result ?? null,
      error: executionResult.error ?? null,
    };

    return `<tool_response>\n${JSON.stringify(payload, null, 2)}\n</tool_response>`;
  }
}

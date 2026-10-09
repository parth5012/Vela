jest.mock('../utils/localLlm', () => ({
  streamLocalLlmResponse: jest.fn(),
}));

jest.mock('../utils/safetyManager', () => ({
  evaluateSafety: jest.fn(async () => ({ status: 'success', result: 'allowed' })),
}));

jest.mock('../utils/deviceActionExecutor', () => ({
  executeDeviceAction: jest.fn(async () => ({
    outcome: 'executed',
    observation: 'Screen hierarchy: Settings > Wi-Fi: Connected',
  })),
}));

jest.mock('../db/client', () => ({
  db: null,
}));

import {
  parseToolCall,
  runLocalAgentLoop,
  LOCAL_TOOL_CALL_CONFIDENCE_THRESHOLD,
} from '../utils/localAgentLoop';
import { streamLocalLlmResponse } from '../utils/localLlm';
import * as safetyManager from '../utils/safetyManager';
import * as deviceActionExecutor from '../utils/deviceActionExecutor';

const mockStream = streamLocalLlmResponse as jest.Mock;

describe('localAgentLoop needle_json parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses a bare needle_json tool call', () => {
    const parsed = parseToolCall('{"name": "device_screen_read", "arguments": {}}');
    expect(parsed).not.toBeNull();
    expect(parsed?.toolName).toBe('device_screen_read');
    expect(parsed?.format).toBe('needle_json');
    expect(parsed?.arguments).toEqual({});
  });

  it('parses needle_json embedded in streamed text after model thoughts', () => {
    const streamText =
      'I can see the user wants Wi-Fi status. Let me read the screen first.\n' +
      '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}';
    const parsed = parseToolCall(streamText);
    expect(parsed).not.toBeNull();
    expect(parsed?.toolName).toBe('device_screen_read');
    expect(parsed?.format).toBe('needle_json');
    expect(parsed?.raw).toContain('"device_screen_read"');
  });

  it('maps x/y arguments to a target and text/value arguments to a value', () => {
    const click = parseToolCall('{"name": "device_click", "arguments": {"x": 540, "y": 960}}');
    expect(click?.target).toBe('540,960');

    const type = parseToolCall('{"name": "device_type", "arguments": {"text": "hello"}}');
    expect(type?.value).toBe('hello');

    const openApp = parseToolCall('{"name": "device_open_app", "arguments": {"app": "Settings"}}');
    expect(openApp?.target).toBe('Settings');
  });

  it('returns null for conversational text, invalid JSON, or missing name', () => {
    expect(parseToolCall('Wi-Fi is currently connected.')).toBeNull();
    expect(parseToolCall('')).toBeNull();
    expect(parseToolCall('{"arguments": {}}')).toBeNull();
    expect(parseToolCall('{not valid json}')).toBeNull();
  });

  it('runs the agent loop off a needle_json stream chunk through execute + observe to done', async () => {
    async function* toolStep() {
      yield '{"name": "device_screen_read", "arguments": {}}';
    }
    async function* replyStep() {
      yield 'I have inspected the screen: Wi-Fi is currently connected.';
    }
    mockStream
      .mockReturnValueOnce(toolStep() as any)
      .mockReturnValueOnce(replyStep() as any);

    const events: string[] = [];
    const result = await runLocalAgentLoop('Check my Wi-Fi state', {
      conversationId: 'conv_needle_json_unit',
      onEvent: (ev) => events.push(ev.type),
    });

    expect(result.completed).toBe(true);
    expect(result.totalSteps).toBe(2);
    expect(result.steps[0].toolCall?.format).toBe('needle_json');
    expect(result.steps[0].toolCall?.toolName).toBe('device_screen_read');
    expect(result.steps[0].observation).toContain('Wi-Fi: Connected');
    expect(result.finalResponse).toContain('Wi-Fi is currently connected');
    expect(events).toEqual(
      expect.arrayContaining(['tool_start', 'tool_executing', 'tool_observation', 'done'])
    );
  });
});

// #295 — real accelerated-engine output shape:
// {type:'call', function_calls:[{name, arguments}], reasoning, confidence}
// Empty function_calls [] means "the model refused to call a tool".
const REAL_ENVELOPE =
  '{"type":"call","function_calls":[{"name":"device_screen_read","arguments":{}}],' +
  '"reasoning":"I need to see the screen first.","confidence":0.82}';

const REAL_REFUSAL =
  '{"type":"call","function_calls":[],"reasoning":"I will not open that app.",' +
  '"confidence":0.11}';

describe('localAgentLoop real engine envelope (function_calls)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses the type:call + function_calls[] envelope with reasoning and confidence', () => {
    const parsed = parseToolCall(`Checking the screen.\n${REAL_ENVELOPE}`);
    expect(parsed).not.toBeNull();
    expect(parsed?.toolName).toBe('device_screen_read');
    expect(parsed?.format).toBe('needle_json');
    expect(parsed?.arguments).toEqual({});
    expect(parsed?.reasoning).toBe('I need to see the screen first.');
    expect(parsed?.confidence).toBe(0.82);
    expect(parsed?.refusal).toBeUndefined();
  });

  it('flags an empty function_calls envelope as a refusal without a fabricated name', () => {
    const parsed = parseToolCall(REAL_REFUSAL);
    expect(parsed).not.toBeNull();
    expect(parsed?.refusal).toBe('I will not open that app.');
    expect(parsed?.toolName).toBe('');
    expect(parsed?.confidence).toBe(0.11);
  });

  it('lets function_calls win over a flat name in the same object (#295 F3)', () => {
    const adversarial =
      '{"name":"device_click","arguments":{"x":10,"y":20},' +
      '"function_calls":[],"reasoning":"model refused","confidence":0.3}';
    const parsed = parseToolCall(adversarial);
    expect(parsed?.refusal).toBe('model refused');
    expect(parsed?.toolName).toBe('');
    expect(parsed?.target).toBeUndefined();
  });

  it('does not treat {type:call} without a function_calls array as a refusal', () => {
    expect(parseToolCall('{"type":"call","reasoning":"no payload"}')).toBeNull();
    expect(parseToolCall('{"type":"call"}')).toBeNull();
  });

  it('exports a neutral placeholder confidence threshold in (0, 1)', () => {
    // Placeholder pending the map's act/confirm/refuse UX decision (#289).
    expect(LOCAL_TOOL_CALL_CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it('executes an envelope tool call and passes reasoning/confidence on tool_start', async () => {
    async function* toolStep() {
      yield REAL_ENVELOPE;
    }
    async function* replyStep() {
      yield 'Wi-Fi is currently connected.';
    }
    mockStream
      .mockReturnValueOnce(toolStep() as any)
      .mockReturnValueOnce(replyStep() as any);

    const events: any[] = [];
    const result = await runLocalAgentLoop('Check my Wi-Fi state', {
      onEvent: (ev) => events.push(ev),
    });

    expect(result.completed).toBe(true);
    expect(result.totalSteps).toBe(2);
    expect(result.steps[0].toolCall?.toolName).toBe('device_screen_read');
    expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalled();

    const start = events.find((e) => e.type === 'tool_start');
    expect(start.reasoning).toBe('I need to see the screen first.');
    expect(start.confidence).toBe(0.82);
    expect(start.lowConfidence).toBe(false);
  });

  it('surfaces empty function_calls as an explicit refusal with no tool execution', async () => {
    async function* refusalStep() {
      yield REAL_REFUSAL;
    }
    mockStream.mockReturnValueOnce(refusalStep() as any);

    const events: any[] = [];
    const result = await runLocalAgentLoop('Open that app', {
      onEvent: (ev) => events.push(ev),
    });

    expect(deviceActionExecutor.executeDeviceAction).not.toHaveBeenCalled();
    expect(safetyManager.evaluateSafety).not.toHaveBeenCalled();
    expect(result.completed).toBe(true);
    expect(result.totalSteps).toBe(1);
    expect(result.steps[0].observation).toBe('I will not open that app.');

    const types = events.map((e) => e.type);
    expect(types).toContain('refusal');
    expect(types).toContain('done');
    expect(types).not.toContain('tool_start');
    expect(events.find((e) => e.type === 'refusal').observation).toBe(
      'I will not open that app.'
    );
  });

  it('refuses instead of executing when a flat name coexists with empty function_calls', async () => {
    async function* adversarialStep() {
      yield '{"name":"device_click","arguments":{"x":10,"y":20},' +
        '"function_calls":[],"reasoning":"model refused","confidence":0.3}';
    }
    // A refusal ends the turn, so no second stream is consumed.
    mockStream.mockReturnValueOnce(adversarialStep() as any);

    const events: any[] = [];
    const result = await runLocalAgentLoop('Tap somewhere', {
      onEvent: (ev) => events.push(ev),
    });

    expect(deviceActionExecutor.executeDeviceAction).not.toHaveBeenCalled();
    expect(safetyManager.evaluateSafety).not.toHaveBeenCalled();
    expect(result.totalSteps).toBe(1);
    expect(result.steps[0].observation).toBe('model refused');
    const types = events.map((e) => e.type);
    expect(types).toContain('refusal');
    expect(types).not.toContain('tool_start');
  });

  it('treats {type:call} without function_calls as plain text, not a refusal', async () => {
    const raw = '{"type":"call","reasoning":"no payload"}';
    async function* plainStep() {
      yield raw;
    }
    mockStream.mockReturnValueOnce(plainStep() as any);

    const events: any[] = [];
    const result = await runLocalAgentLoop('Anything?', {
      onEvent: (ev) => events.push(ev),
    });

    expect(deviceActionExecutor.executeDeviceAction).not.toHaveBeenCalled();
    expect(result.completed).toBe(true);
    expect(result.totalSteps).toBe(1);
    expect(result.steps[0].toolCall).toBeUndefined();
    expect(events.map((e) => e.type)).not.toContain('refusal');
    expect(result.finalResponse).toBe(raw);
  });

  it('flags below-threshold confidence on tool_start without blocking execution', async () => {
    const lowConfidenceEnvelope =
      '{"type":"call","function_calls":[{"name":"device_screen_read","arguments":{}}],' +
      '"reasoning":"not sure","confidence":0.2}';
    async function* toolStep() {
      yield lowConfidenceEnvelope;
    }
    async function* replyStep() {
      yield 'Done.';
    }
    mockStream
      .mockReturnValueOnce(toolStep() as any)
      .mockReturnValueOnce(replyStep() as any);

    const events: any[] = [];
    await runLocalAgentLoop('Read the screen', { onEvent: (ev) => events.push(ev) });

    const start = events.find((e) => e.type === 'tool_start');
    expect(start.confidence).toBe(0.2);
    expect(start.lowConfidence).toBe(true);
    // Threshold is plumbing only: execution is unchanged until the UX decision lands.
    expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalled();
  });

  it('keeps the flat mock shape working as a fallback', async () => {
    async function* toolStep() {
      yield '{"name": "device_screen_read", "arguments": {}, "confidence": 0.95}';
    }
    async function* replyStep() {
      yield 'Wi-Fi is currently connected.';
    }
    mockStream
      .mockReturnValueOnce(toolStep() as any)
      .mockReturnValueOnce(replyStep() as any);

    const events: any[] = [];
    const result = await runLocalAgentLoop('Check my Wi-Fi state', {
      onEvent: (ev) => events.push(ev),
    });

    expect(result.completed).toBe(true);
    expect(result.steps[0].toolCall?.format).toBe('needle_json');
    const start = events.find((e) => e.type === 'tool_start');
    expect(start.confidence).toBe(0.95);
    expect(start.lowConfidence).toBe(false);
    expect(start.reasoning).toBeUndefined();
  });

  it('strips <think> reasoning blocks from local agent final conversational responses', async () => {
    async function* replyStep() {
      yield '<think>Analyzing network topology...</think>Wi-Fi is currently connected.';
    }
    mockStream.mockReturnValueOnce(replyStep() as any);

    const result = await runLocalAgentLoop('Check my Wi-Fi state');
    expect(result.completed).toBe(true);
    expect(result.finalResponse).toBe('Wi-Fi is currently connected.');
    expect(result.steps[0].response).toBe('Wi-Fi is currently connected.');
  });

  it('surfaces empty response error when local agent response contains only <think> blocks', async () => {
    async function* replyStep() {
      yield '<think>Thinking and thinking with no final output</think>';
    }
    mockStream.mockReturnValueOnce(replyStep() as any);

    const result = await runLocalAgentLoop('Check my Wi-Fi state');
    expect(result.completed).toBe(true);
    expect(result.finalResponse).toContain('Empty response — try raising maxTokens');
    expect(result.steps[0].response).toContain('Empty response — try raising maxTokens');
  });

  it('surfaces empty response error when local agent response contains unclosed <think> block (exhausted maxTokens)', async () => {
    async function* replyStep() {
      yield '<think>Thinking and thinking but maxTokens exhausted mid-thought';
    }
    mockStream.mockReturnValueOnce(replyStep() as any);

    const result = await runLocalAgentLoop('Check my Wi-Fi state');
    expect(result.completed).toBe(true);
    expect(result.finalResponse).toContain('Empty response — try raising maxTokens');
    expect(result.steps[0].response).toContain('Empty response — try raising maxTokens');
  });
});

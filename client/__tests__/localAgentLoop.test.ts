jest.mock('../utils/localLlm', () => ({
  streamLocalLlmResponse: jest.fn(),
}));

jest.mock('../utils/safetyManager', () => ({
  evaluateSafety: jest.fn(async () => ({ status: 'success', result: 'allowed' })),
}));

jest.mock('../utils/deviceActionExecutor', () => ({
  executeDeviceAction: jest.fn(async () => 'Screen hierarchy: Settings > Wi-Fi: Connected'),
}));

jest.mock('../db/client', () => ({
  db: null,
}));

import { parseToolCall, runLocalAgentLoop } from '../utils/localAgentLoop';
import { streamLocalLlmResponse } from '../utils/localLlm';

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

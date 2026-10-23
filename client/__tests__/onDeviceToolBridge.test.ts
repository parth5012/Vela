import {
  OnDeviceToolBridge,
  ON_DEVICE_TOOL_SCHEMAS,
  type ToolCallRequest,
  type ConsentGateHandler,
  type ToolExecutorRegistry,
} from '../utils/onDeviceToolBridge';

describe('WF-07: On-Device Tool-Calling Bridge with Consent Gates', () => {
  let mockConsentGate: jest.Mock;
  let mockExecutors: ToolExecutorRegistry;

  beforeEach(() => {
    mockConsentGate = jest.fn();
    mockExecutors = {
      get_alarms: jest.fn().mockResolvedValue({ alarms: [{ id: '1', time: '07:00', label: 'Work' }] }),
      set_alarm: jest.fn().mockResolvedValue({ success: true, id: 'alarm_2', time: '07:30', label: 'Morning Workout' }),
      get_calendar_events: jest.fn().mockResolvedValue({ events: [{ id: 'c1', title: 'Team Sync', time: '10:00' }] }),
      create_calendar_event: jest.fn().mockResolvedValue({ success: true, eventId: 'c2', title: 'Dentist' }),
      get_recent_messages: jest.fn().mockResolvedValue({ messages: [{ from: 'Alice', text: 'Hey there' }] }),
      send_message: jest.fn().mockResolvedValue({ success: true, messageId: 'm1', sentTo: 'Alice' }),
      read_clipboard: jest.fn().mockResolvedValue({ text: 'https://github.com/parth5012/Vela' }),
      write_clipboard: jest.fn().mockResolvedValue({ success: true }),
    };
  });

  describe('Tool Schemas for Approved Capabilities (Alarms, Calendar, Messages, Clipboard)', () => {
    it('defines schemas for all WF-01 approved capabilities with read/write classification', () => {
      const toolNames = ON_DEVICE_TOOL_SCHEMAS.map((t) => t.name);

      expect(toolNames).toContain('get_alarms');
      expect(toolNames).toContain('set_alarm');
      expect(toolNames).toContain('get_calendar_events');
      expect(toolNames).toContain('create_calendar_event');
      expect(toolNames).toContain('get_recent_messages');
      expect(toolNames).toContain('send_message');
      expect(toolNames).toContain('read_clipboard');
      expect(toolNames).toContain('write_clipboard');

      // Verify mutation classification
      const setAlarm = ON_DEVICE_TOOL_SCHEMAS.find((t) => t.name === 'set_alarm');
      expect(setAlarm?.isMutating).toBe(true);

      const getAlarms = ON_DEVICE_TOOL_SCHEMAS.find((t) => t.name === 'get_alarms');
      expect(getAlarms?.isMutating).toBe(false);

      const sendMsg = ON_DEVICE_TOOL_SCHEMAS.find((t) => t.name === 'send_message');
      expect(sendMsg?.isMutating).toBe(true);

      const readClip = ON_DEVICE_TOOL_SCHEMAS.find((t) => t.name === 'read_clipboard');
      expect(readClip?.isMutating).toBe(false);
    });
  });

  describe('Tool Call Parser (JSON, Code blocks, XML tags)', () => {
    const bridge = new OnDeviceToolBridge();

    it('parses raw JSON tool calls', () => {
      const raw = '{"name": "set_alarm", "arguments": {"hour": 7, "minute": 30, "label": "Morning Workout"}}';
      const parsed = bridge.parseToolCall(raw);

      expect(parsed).not.toBeNull();
      expect(parsed?.name).toBe('set_alarm');
      expect(parsed?.arguments.hour).toBe(7);
      expect(parsed?.arguments.label).toBe('Morning Workout');
    });

    it('parses tool calls wrapped in markdown code blocks', () => {
      const markdown = '```json\n{"name": "get_calendar_events", "arguments": {"start_date": "2026-10-23"}}\n```';
      const parsed = bridge.parseToolCall(markdown);

      expect(parsed).not.toBeNull();
      expect(parsed?.name).toBe('get_calendar_events');
      expect(parsed?.arguments.start_date).toBe('2026-10-23');
    });

    it('parses tool calls wrapped in <tool_call> XML tags', () => {
      const xml = '<tool_call>{"name": "send_message", "arguments": {"recipient": "Alice", "message_text": "On my way!"}}</tool_call>';
      const parsed = bridge.parseToolCall(xml);

      expect(parsed).not.toBeNull();
      expect(parsed?.name).toBe('send_message');
      expect(parsed?.arguments.recipient).toBe('Alice');
    });

    it('returns null when text contains no valid tool calls', () => {
      const regularText = 'Hello! The weather today in San Francisco is 65°F and sunny.';
      const parsed = bridge.parseToolCall(regularText);

      expect(parsed).toBeNull();
    });
  });

  describe('Security Consent Gate (Deny-by-default for Mutating Actions)', () => {
    it('executes read-only actions automatically without consent dialog', async () => {
      const bridge = new OnDeviceToolBridge({
        consentGate: mockConsentGate,
        executors: mockExecutors,
      });

      const call: ToolCallRequest = {
        name: 'get_alarms',
        arguments: {},
      };

      const result = await bridge.executeToolCall(call);

      expect(mockConsentGate).not.toHaveBeenCalled();
      expect(mockExecutors.get_alarms).toHaveBeenCalled();
      expect(result.status).toBe('success');
      expect(result.result).toEqual({ alarms: [{ id: '1', time: '07:00', label: 'Work' }] });
    });

    it('requests user confirmation for mutating actions and succeeds when approved', async () => {
      mockConsentGate.mockResolvedValue({ approved: true });

      const bridge = new OnDeviceToolBridge({
        consentGate: mockConsentGate,
        executors: mockExecutors,
      });

      const call: ToolCallRequest = {
        name: 'set_alarm',
        arguments: { hour: 7, minute: 30, label: 'Morning Workout' },
      };

      const result = await bridge.executeToolCall(call);

      expect(mockConsentGate).toHaveBeenCalledWith(call);
      expect(mockExecutors.set_alarm).toHaveBeenCalledWith(call.arguments);
      expect(result.status).toBe('success');
      expect(result.result.id).toBe('alarm_2');
    });

    it('denies mutating actions by default when user cancels confirmation dialog', async () => {
      mockConsentGate.mockResolvedValue({ approved: false, reason: 'User cancelled' });

      const bridge = new OnDeviceToolBridge({
        consentGate: mockConsentGate,
        executors: mockExecutors,
      });

      const call: ToolCallRequest = {
        name: 'send_message',
        arguments: { recipient: 'Alice', message_text: 'Secret msg' },
      };

      const result = await bridge.executeToolCall(call);

      expect(mockConsentGate).toHaveBeenCalledWith(call);
      expect(mockExecutors.send_message).not.toHaveBeenCalled();
      expect(result.status).toBe('denied');
      expect(result.error).toContain('denied by user consent gate');
    });
  });

  describe('Hard Cap: Maximum 3 Tool Calls per Turn', () => {
    it('enforces hard cap of 3 tool calls and rejects subsequent calls in the same turn', async () => {
      const bridge = new OnDeviceToolBridge({
        consentGate: jest.fn().mockResolvedValue({ approved: true }),
        executors: mockExecutors,
      });

      bridge.startNewTurn();

      // Calls 1, 2, 3 should succeed
      const call1 = await bridge.executeToolCall({ name: 'get_alarms', arguments: {} });
      const call2 = await bridge.executeToolCall({ name: 'read_clipboard', arguments: {} });
      const call3 = await bridge.executeToolCall({ name: 'get_recent_messages', arguments: {} });

      expect(call1.status).toBe('success');
      expect(call2.status).toBe('success');
      expect(call3.status).toBe('success');

      // 4th call should be blocked by the hard cap
      const call4 = await bridge.executeToolCall({ name: 'get_calendar_events', arguments: {} });

      expect(call4.status).toBe('limit_exceeded');
      expect(call4.error).toContain('maximum 3 tool calls permitted per turn');
      expect(mockExecutors.get_calendar_events).not.toHaveBeenCalled();
    });

    it('resets tool call count on new turn', async () => {
      const bridge = new OnDeviceToolBridge({
        consentGate: jest.fn().mockResolvedValue({ approved: true }),
        executors: mockExecutors,
      });

      bridge.startNewTurn();
      await bridge.executeToolCall({ name: 'get_alarms', arguments: {} });
      await bridge.executeToolCall({ name: 'get_alarms', arguments: {} });
      await bridge.executeToolCall({ name: 'get_alarms', arguments: {} });

      // Start fresh turn
      bridge.startNewTurn();
      const freshCall = await bridge.executeToolCall({ name: 'get_alarms', arguments: {} });

      expect(freshCall.status).toBe('success');
    });
  });

  describe('Scripted Demo: Reminder/Alarm Workflow with Continuation', () => {
    it('executes full interactive turn: prompt -> model tool call -> confirmation -> executor -> continuation result', async () => {
      mockConsentGate.mockResolvedValue({ approved: true });

      const bridge = new OnDeviceToolBridge({
        consentGate: mockConsentGate,
        executors: mockExecutors,
      });

      const userPrompt = 'Please set an alarm for 7:30 AM named Morning Workout';
      const modelFirstTurnOutput = '<tool_call>{"name": "set_alarm", "arguments": {"hour": 7, "minute": 30, "label": "Morning Workout"}}</tool_call>';

      // Step 1: Parse model tool call
      const toolCall = bridge.parseToolCall(modelFirstTurnOutput);
      expect(toolCall).not.toBeNull();

      // Step 2: Execute tool with consent gate
      const executionResult = await bridge.executeToolCall(toolCall!);
      expect(executionResult.status).toBe('success');

      // Step 3: Format continuation message for model context
      const continuationContext = bridge.formatToolResultForContext(toolCall!, executionResult);
      expect(continuationContext).toContain('set_alarm');
      expect(continuationContext).toContain('alarm_2');
      expect(continuationContext).toContain('Morning Workout');

      // Simulated model final summary
      const modelSummary = `I have set your alarm for 7:30 AM named Morning Workout.`;
      expect(modelSummary).toContain('7:30 AM');
    });
  });
});

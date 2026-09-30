import {
  parseToolCall,
  runLocalAgentLoop,
  ParsedToolCall,
} from '../localAgentLoop';
import * as localLlm from '../localLlm';
import * as safetyManager from '../safetyManager';
import * as deviceActionExecutor from '../deviceActionExecutor';

jest.mock('../../modules/device-agent', () => ({
  default: {
    getScreenTree: jest.fn().mockResolvedValue(''),
    getDeviceInfo: jest.fn().mockResolvedValue({}),
    takeScreenshot: jest.fn().mockResolvedValue(''),
    performAction: jest.fn().mockResolvedValue(true),
  },
}));
jest.mock('../localLlm');
jest.mock('../safetyManager');
jest.mock('../deviceActionExecutor');

// #308: a real (fake) db so the executed/failed/unavailable distinction that
// reaches operationLog can be asserted instead of skipped by the `!db` guard.
const mockDbValues = jest.fn().mockResolvedValue(undefined);
const mockDbInsert = jest.fn(() => ({ values: mockDbValues }));
jest.mock('../../db/client', () => ({
  get db() {
    return { insert: mockDbInsert };
  },
}));

describe('localAgentLoop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseToolCall', () => {
    it('parses Needle JSON tool format', () => {
      const text = 'Checking screen: {"name": "device_screen_read", "arguments": {}, "confidence": 0.95}';
      const parsed = parseToolCall(text);
      expect(parsed).not.toBeNull();
      expect(parsed?.toolName).toBe('device_screen_read');
      expect(parsed?.format).toBe('needle_json');
    });

    it('parses Needle JSON click format with coordinates', () => {
      const text = '{"name": "device_click", "arguments": {"x": 500, "y": 1000}}';
      const parsed = parseToolCall(text);
      expect(parsed?.toolName).toBe('device_click');
      expect(parsed?.target).toBe('500,1000');
    });

    it('parses XML tool format with tags', () => {
      const text = '<call name="device_type"><arg name="value">Test Input</arg></call>';
      const parsed = parseToolCall(text);
      expect(parsed).not.toBeNull();
      expect(parsed?.toolName).toBe('device_type');
      expect(parsed?.value).toBe('Test Input');
      expect(parsed?.format).toBe('xml');
    });

    it('returns null when no tool call is present', () => {
      const text = 'Hello, how can I assist you today on your Android device?';
      expect(parseToolCall(text)).toBeNull();
    });
  });

  describe('runLocalAgentLoop execution', () => {
    it('executes a single step when model returns normal conversational text', async () => {
      async function* mockStream() {
        yield 'Hello there! ';
        yield 'I am your offline assistant.';
      }
      (localLlm.streamLocalLlmResponse as jest.Mock).mockReturnValue(mockStream());

      const result = await runLocalAgentLoop('Hello');
      expect(result.completed).toBe(true);
      expect(result.totalSteps).toBe(1);
      expect(result.finalResponse).toBe('Hello there! I am your offline assistant.');
    });

    it('executes device action and loops back observation when tool is called', async () => {
      // Step 1: Model calls tool
      async function* step1Stream() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }
      // Step 2: Model receives observation and gives final answer
      async function* step2Stream() {
        yield 'The screen contains Settings and Wi-Fi options.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(step1Stream())
        .mockReturnValueOnce(step2Stream());

      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });

      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Screen tree: Settings > Network > Wi-Fi',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('What is on my screen?', {
        onEvent: (e) => events.push(e),
      });

      expect(safetyManager.evaluateSafety).toHaveBeenCalledWith(
        'device_screen_read',
        undefined,
        undefined,
        undefined,
        expect.any(String)
      );
      expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalledWith(
        'device_screen_read',
        undefined,
        undefined
      );
      expect(result.totalSteps).toBe(2);
      expect(result.completed).toBe(true);
      expect(result.finalResponse).toBe('The screen contains Settings and Wi-Fi options.');
    });

    it('stops after 5 steps if model continuously invokes tools', async () => {
      async function* endlessToolStream() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock).mockImplementation(() => endlessToolStream());
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({ status: 'success', result: 'allowed' });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Screen tree mock',
      });

      const result = await runLocalAgentLoop('Infinite task', { maxSteps: 5 });
      expect(result.totalSteps).toBe(5);
      expect(result.completed).toBe(false);
    });

    it('handles safety block and feeds safety error as observation', async () => {
      async function* toolStream() {
        yield '{"name": "device_open_app", "arguments": {"app": "Superuser Root"}}';
      }
      async function* finalStream() {
        yield 'I cannot open root applications due to security policy.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(finalStream());

      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'error',
        result: 'Root app access denied',
      });

      const result = await runLocalAgentLoop('Open root app');
      expect(deviceActionExecutor.executeDeviceAction).not.toHaveBeenCalled();
      expect(result.steps[0].safetyStatus).toBe('error');
      expect(result.steps[0].observation).toContain('Root app access denied');
      expect(result.totalSteps).toBe(2);
      expect(result.completed).toBe(true);
    });

    it('safely rejects unknown or hallucinated tool names without executing', async () => {
      async function* badToolStream() {
        yield '{"name": "malicious_unregistered_tool", "arguments": {"target": "secret"}}';
      }
      async function* recoveryStream() {
        yield 'Recovered from unknown tool call.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(badToolStream())
        .mockReturnValueOnce(recoveryStream());

      const result = await runLocalAgentLoop('Try bad tool');
      expect(deviceActionExecutor.executeDeviceAction).not.toHaveBeenCalled();
      expect(result.steps[0].observation).toContain('Unknown device tool');
      expect(result.totalSteps).toBe(2);
      expect(result.completed).toBe(true);
    });
  });

  // #308 — execution-outcome integrity: a capability that never ran must never
  // be recorded, reported, or fed back to the model as an execution.
  describe('execution outcome recording (#308)', () => {
    function toolThenAnswer() {
      async function* toolStream() {
        yield '{"name": "device_click", "arguments": {"x": 500, "y": 1000}}';
      }
      async function* answerStream() {
        yield 'Clicked the Settings icon.';
      }
      return [toolStream(), answerStream()];
    }

    const loggedStatus = (call: number) => {
      const row = mockDbValues.mock.calls[call][0] as { payload: string };
      return JSON.parse(row.payload).status as string;
    };

    it('records unavailable capability as not executed and tells the model so', async () => {
      const [first, second] = toolThenAnswer();
      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'unavailable',
        observation: 'Action NOT executed: device agent capability unavailable.',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('Click Settings', {
        onEvent: (e) => events.push(e),
      });

      expect(result.steps[0].executionStatus).toBe('unavailable');
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      expect(loggedStatus(0)).toBe('unavailable');

      const observationEvent = events.find((e) => e.type === 'tool_observation');
      expect(observationEvent.error).toBeTruthy();
      expect(observationEvent.observation).toContain('NOT executed');

      const nextPrompt = (localLlm.streamLocalLlmResponse as jest.Mock).mock
        .calls[1][0] as string;
      expect(nextPrompt).toContain('NOT executed');
      expect(nextPrompt).not.toContain('Observation: Success');
    });

    it('records a native failure as failed, not executed', async () => {
      const [first, second] = toolThenAnswer();
      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'failed',
        observation: 'Action failed: accessibility permission is off.',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('Click Settings', {
        onEvent: (e) => events.push(e),
      });

      expect(result.steps[0].executionStatus).toBe('failed');
      expect(loggedStatus(0)).toBe('failed');
      expect(events.find((e) => e.type === 'tool_observation').error).toBeTruthy();
    });

    it('still records a real success as executed', async () => {
      const [first, second] = toolThenAnswer();
      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Success',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('Click Settings', {
        onEvent: (e) => events.push(e),
      });

      expect(result.steps[0].executionStatus).toBe('executed');
      expect(loggedStatus(0)).toBe('executed');
      expect(events.find((e) => e.type === 'tool_observation').error).toBeUndefined();
    });

    it('keeps a safety block logged as blocked', async () => {
      async function* toolStream() {
        yield '{"name": "device_open_app", "arguments": {"app": "Superuser Root"}}';
      }
      async function* answerStream() {
        yield 'No.';
      }
      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(answerStream());
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'error',
        result: 'Root app access denied',
      });

      await runLocalAgentLoop('Open root app');

      expect(deviceActionExecutor.executeDeviceAction).not.toHaveBeenCalled();
      expect(loggedStatus(0)).toBe('blocked');
    });
  });
});

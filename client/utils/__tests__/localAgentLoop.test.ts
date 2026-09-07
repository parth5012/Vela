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
jest.mock('../../db/client', () => ({ db: null }));

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

      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue(
        'Screen tree: Settings > Network > Wi-Fi'
      );

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
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue('Screen tree mock');

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
});

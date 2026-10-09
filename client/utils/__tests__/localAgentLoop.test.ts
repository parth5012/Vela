import {
  parseToolCall,
  runLocalAgentLoop,
  isScreenLoading,
  clearLoadingMarkers,
  isKeyboardBlocking,
  isTargetOffScreenScrollable,
  isScreenSnapshot,
  getHierarchySignature,
  isHierarchyUnchanged,
  detectRecoveryAction,
  DEFAULT_MAX_STEPS,
  DEFAULT_UNCHANGED_HIERARCHY_THRESHOLD,
  MAX_TOTAL_RECOVERY_WAITS,
  ParsedToolCall,
} from '../localAgentLoop';
import { useConfigStore } from '../../store/useConfigStore';
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
    (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
      status: 'success',
      result: 'allowed',
    });
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

    it('records an indeterminate outcome distinctly from a clean failure', async () => {
      const [first, second] = toolThenAnswer();
      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'indeterminate',
        observation: 'Action result UNKNOWN: device_click may already have taken effect.',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('Click Settings', {
        onEvent: (e) => events.push(e),
      });

      expect(result.steps[0].executionStatus).toBe('indeterminate');
      expect(loggedStatus(0)).toBe('indeterminate');
      const observationEvent = events.find((e) => e.type === 'tool_observation');
      expect(observationEvent.error).toBeTruthy();
      const nextPrompt = (localLlm.streamLocalLlmResponse as jest.Mock).mock
        .calls[1][0] as string;
      expect(nextPrompt).toContain('may already have taken effect');
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

  describe('pure recovery heuristics functions', () => {
    it('isScreenLoading identifies loading indicators accurately', () => {
      expect(isScreenLoading('Screen contains ProgressBar: loading...')).toBe(true);
      expect(isScreenLoading('[e1] CircularProgressIndicator bounds=[10,10,20,20]')).toBe(true);
      expect(isScreenLoading('state="loading" please wait')).toBe(true);
      expect(isScreenLoading('Node: desc="Loading"')).toBe(true);
      expect(isScreenLoading('Normal screen with Settings and Network')).toBe(false);
      expect(isScreenLoading('')).toBe(false);
    });

    it('isKeyboardBlocking identifies GBoard and keyboard obstruction', () => {
      expect(isKeyboardBlocking('Package com.google.android.inputmethod.latin visible', '@e5')).toBe(false);
      expect(isKeyboardBlocking('Package com.google.android.inputmethod.latin visible blocking @e5', '@e5')).toBe(true);
      expect(isKeyboardBlocking('Keyboard is blocking the submit button', 'submit')).toBe(true);
      expect(isKeyboardBlocking('LatinIME SoftKeyboard visible blocking @target_input', '@target_input')).toBe(true);
      expect(isKeyboardBlocking('Standard view without keyboard', '@e5')).toBe(false);
      expect(isKeyboardBlocking('')).toBe(false);
    });

    it('isTargetOffScreenScrollable detects off-screen targets in scrollable containers', () => {
      const scrollableWithOffscreen =
        'ScrollView: scrollable\n' +
        '[@e1] Button: text="Submit" bounds=[0,150,100,200]px(0,1200,1080,1400)';
      expect(isTargetOffScreenScrollable(scrollableWithOffscreen, '@e1')).toBe(true);

      const explicitlyMarked =
        'RecyclerView: scrollable\n' +
        '[@e2] Option: text="Save" off-screen';
      expect(isTargetOffScreenScrollable(explicitlyMarked, '@e2')).toBe(true);

      const visibleOnScreen =
        'ScrollView: scrollable\n' +
        '[@e3] Button: text="Cancel" bounds=[0,30,100,50]px(0,300,1080,500)';
      expect(isTargetOffScreenScrollable(visibleOnScreen, '@e3')).toBe(false);

      const nonScrollable =
        'LinearLayout:\n' +
        '[@e4] Button: text="Click" bounds=[0,150,100,200]';
      expect(isTargetOffScreenScrollable(nonScrollable, '@e4')).toBe(false);
    });

    it('isScreenSnapshot identifies screen hierarchy dumps and rejects non-screen strings', () => {
      expect(isScreenSnapshot('Screen tree: Settings > Wi-Fi')).toBe(true);
      expect(isScreenSnapshot('[@e1] Button: bounds=[0,0,10,10] clickable')).toBe(true);
      expect(isScreenSnapshot('ScrollView: scrollable')).toBe(true);
      expect(isScreenSnapshot('Package com.android.settings visible')).toBe(true);
      expect(isScreenSnapshot('Success')).toBe(false);
      expect(isScreenSnapshot('Action failed')).toBe(false);
      expect(isScreenSnapshot('')).toBe(false);
    });

    it('getHierarchySignature normalizes timestamps and coordinates', () => {
      const h1 = 'Screen tree: [@e1] Text="Hi" 1712345678901 px(0,100,200,300)';
      const h2 = 'Screen tree: [@e1] Text="Hi" 1712345679999 px(0,100,200,300)';
      expect(getHierarchySignature(h1)).toBe(getHierarchySignature(h2));
      expect(isHierarchyUnchanged(getHierarchySignature(h1), getHierarchySignature(h2))).toBe(true);
      expect(isHierarchyUnchanged('', '')).toBe(false);
    });

    it('detectRecoveryAction maps all 4 heuristic triggers to recovery actions', () => {
      // 1. Loading -> wait
      const waitAction = detectRecoveryAction({
        screenContent: 'Screen with ProgressBar: Loading...',
        consecutiveUnchangedCount: 0,
      });
      expect(waitAction?.type).toBe('wait');

      // 2. Keyboard blocking -> back
      const keyboardAction = detectRecoveryAction({
        screenContent: 'GBoard is blocking the target',
        target: '@input',
        consecutiveUnchangedCount: 0,
      });
      expect(keyboardAction?.type).toBe('back');

      // 3. Off-screen tap in scrollable -> scroll_and_retap
      const scrollAction = detectRecoveryAction({
        screenContent: 'ScrollView: scrollable\n[@target] Button off-screen',
        target: '@target',
        toolName: 'device_click',
        consecutiveUnchangedCount: 0,
      });
      expect(scrollAction?.type).toBe('scroll_and_retap');

      // 4. Unchanged hierarchy N times -> back, then home reset
      const backAction = detectRecoveryAction({
        screenContent: 'Stable screen',
        consecutiveUnchangedCount: 3,
        unchangedThreshold: 3,
      });
      expect(backAction?.type).toBe('back');

      const homeResetAction = detectRecoveryAction({
        screenContent: 'Stable screen',
        consecutiveUnchangedCount: 3,
        unchangedThreshold: 3,
        lastRecoveryAction: 'back',
      });
      expect(homeResetAction?.type).toBe('home_reset');
    });
  });

  describe('configurable maxSteps and recovery engine integration in runLocalAgentLoop', () => {
    it('enforces default maxSteps of 15 when cap is enabled', async () => {
      async function* endlessTool() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }
      (localLlm.streamLocalLlmResponse as jest.Mock).mockImplementation(() => endlessTool());
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({ status: 'success', result: 'allowed' });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Varying content ' + Math.random(),
      });

      const result = await runLocalAgentLoop('Endless loop');
      expect(result.totalSteps).toBe(DEFAULT_MAX_STEPS); // 15
      expect(result.completed).toBe(false);
    });

    it('allows disabling step cap (maxStepsEnabled: false) for unlimited execution', async () => {
      let callCount = 0;
      async function* streamProducer() {
        callCount++;
        if (callCount <= 18) {
          yield '{"name": "device_screen_read", "arguments": {}}';
        } else {
          yield 'Task finished after 18 steps.';
        }
      }
      (localLlm.streamLocalLlmResponse as jest.Mock).mockImplementation(() => streamProducer());
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({ status: 'success', result: 'allowed' });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          outcome: 'executed',
          observation: 'Step observation ' + callCount,
        })
      );

      const result = await runLocalAgentLoop('Long task', { maxStepsEnabled: false });
      expect(result.completed).toBe(true);
      expect(result.totalSteps).toBe(19);
      expect(result.finalResponse).toBe('Task finished after 18 steps.');
    });

    it('does not consume maxSteps budget during recovery wait steps', async () => {
      // Step 1: Model calls tool on loading screen -> triggers wait recovery (does not increment step)
      // Step 2: Model finishes conversationally
      async function* toolStream() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }
      async function* finalStream() {
        yield 'Page loaded completely.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(finalStream());

      const events: any[] = [];
      const result = await runLocalAgentLoop('Wait for loading', {
        initialScreenContent: 'Screen tree: ProgressBar: Loading...',
        waitMs: 0,
        maxSteps: 1, // Cap is 1! If wait consumed a step, the loop would fail/stop
        onEvent: (e) => events.push(e),
      });

      expect(events.some((e) => e.type === 'recovery' && e.recoveryType === 'wait')).toBe(true);
      expect(result.completed).toBe(true);
      expect(result.finalResponse).toBe('Page loaded completely.');
      // The wait was recorded, but step stayed within budget
      expect(result.steps.some((s) => s.recoveryAction === 'wait')).toBe(true);
    });

    it('fires keyboard blocking recovery branch by pressing BACK to dismiss keyboard', async () => {
      async function* toolStream() {
        yield '{"name": "device_click", "arguments": {"target": "@submit_btn"}}';
      }
      async function* finalStream() {
        yield 'Done after keyboard dismiss.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(finalStream());

      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Success',
      });

      const events: any[] = [];
      const prompt = 'Click submit button';
      const result = await runLocalAgentLoop(prompt, {
        initialScreenContent: 'Screen tree: com.google.android.inputmethod.latin visible blocking @submit_btn',
        onEvent: (e) => events.push(e),
      });

      expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalledWith(
        'device_press_key',
        'BACK'
      );
      expect(events.some((e) => e.type === 'recovery' && e.recoveryType === 'back')).toBe(true);
      expect(result.completed).toBe(true);
    });

    it('fires off-screen scrollable recovery branch by scrolling and then retapping', async () => {
      async function* toolStream() {
        yield '{"name": "device_click", "arguments": {"target": "@offscreen_card"}}';
      }
      async function* finalStream() {
        yield 'Card clicked successfully.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(finalStream());

      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Tapped after scroll',
      });

      const prompt = 'Click offscreen card';
      const events: any[] = [];
      const result = await runLocalAgentLoop(prompt, {
        initialScreenContent: 'ScrollView: scrollable container. Target [@offscreen_card] off-screen',
        onEvent: (e) => events.push(e),
      });

      expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalledWith(
        'device_scroll',
        '@offscreen_card',
        'down'
      );
      expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalledWith(
        'device_click',
        '@offscreen_card',
        undefined
      );
      expect(events.some((e) => e.type === 'recovery' && e.recoveryType === 'scroll')).toBe(true);
      expect(result.completed).toBe(true);
    });

    it('fires unchanged hierarchy recovery: back at threshold N, then home reset if still unchanged', async () => {
      async function* continuousClick() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock).mockImplementation(() => continuousClick());
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({ status: 'success', result: 'allowed' });
      // Always return the exact same static hierarchy
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Screen tree: Static frozen screen',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('Start task', {
        unchangedThreshold: 2,
        maxSteps: 6,
        onEvent: (e) => events.push(e),
      });

      // Verify BACK was pressed when threshold was reached
      expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalledWith(
        'device_press_key',
        'BACK'
      );
      // Verify HOME reset was pressed when screen remained unchanged after BACK
      expect(deviceActionExecutor.executeDeviceAction).toHaveBeenCalledWith(
        'device_press_key',
        'HOME'
      );

      const recoveryEvents = events.filter((e) => e.type === 'recovery');
      expect(recoveryEvents.some((e) => e.recoveryType === 'back')).toBe(true);
      expect(recoveryEvents.some((e) => e.recoveryType === 'home_reset')).toBe(true);
      expect(result.steps.some((s) => s.recoveryAction === 'home_reset')).toBe(true);
    });

    it('Finding 1 repro: scroll_and_retap does not execute re-tap and reports blocked when safety denies the tool', async () => {
      async function* toolStream() {
        yield '{"name": "device_click", "arguments": {"target": "@offscreen_card"}}';
      }
      async function* finalStream() {
        yield 'Blocked by policy.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(finalStream());

      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'error',
        result: 'Denied clicking card by policy',
      });

      const prompt = 'Click card';
      const result = await runLocalAgentLoop(prompt, {
        initialScreenContent: 'ScrollView: scrollable container. Target [@offscreen_card] off-screen',
      });

      expect(safetyManager.evaluateSafety).toHaveBeenCalledWith(
        'device_click',
        '@offscreen_card',
        undefined,
        undefined,
        expect.any(String)
      );
      expect(deviceActionExecutor.executeDeviceAction).not.toHaveBeenCalled();
      expect(result.steps[0].executionStatus).toBe('blocked');
      expect(mockDbInsert).toHaveBeenCalled();
      const lastCall = mockDbValues.mock.calls.length - 1;
      const row = mockDbValues.mock.calls[lastCall][0] as { payload: string };
      expect(JSON.parse(row.payload).status).toBe('blocked');
    });

    it('Finding 1 repro: recovery actions back and home_reset evaluate safety and write audit log', async () => {
      async function* continuousClick() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock).mockImplementation(() => continuousClick());
      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({ status: 'success', result: 'allowed' });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Screen tree: Static frozen screen',
      });

      await runLocalAgentLoop('Start task', {
        unchangedThreshold: 2,
        maxSteps: 4,
      });

      expect(safetyManager.evaluateSafety).toHaveBeenCalledWith(
        'device_press_key',
        'BACK',
        undefined,
        undefined,
        expect.any(String)
      );
      expect(mockDbInsert).toHaveBeenCalled();
      const loggedRows = mockDbValues.mock.calls.map((c: any) => JSON.parse(c[0].payload));
      expect(loggedRows.some((r: any) => r.toolName === 'device_press_key' && r.target === 'BACK')).toBe(true);
    });

    it('Finding 2 repro: device_type with keyboard merely visible returns null, while explicit obstruction returns back', () => {
      const visibleKeyboardContent = 'Package com.google.android.inputmethod.latin visible\n[@search_input] EditText bounds=[0,10,100,20]';
      expect(isKeyboardBlocking(visibleKeyboardContent, '@search_input')).toBe(false);

      const actionUnobstructed = detectRecoveryAction({
        screenContent: visibleKeyboardContent,
        target: '@search_input',
        toolName: 'device_type',
        consecutiveUnchangedCount: 0,
      });
      expect(actionUnobstructed).toBeNull();

      const blockedContent = 'com.google.android.inputmethod.latin keyboard is blocking @search_input';
      expect(isKeyboardBlocking(blockedContent, '@search_input')).toBe(true);

      const actionBlocked = detectRecoveryAction({
        screenContent: blockedContent,
        target: '@search_input',
        toolName: 'device_type',
        consecutiveUnchangedCount: 0,
      });
      expect(actionBlocked?.type).toBe('back');
    });

    it('Finding 3 repro: 4 consecutive device_click steps returning Success produce zero recovery events', async () => {
      async function* click1() {
        yield '{"name": "device_click", "arguments": {"target": "@item1"}}';
      }
      async function* click2() {
        yield '{"name": "device_click", "arguments": {"target": "@item2"}}';
      }
      async function* click3() {
        yield '{"name": "device_click", "arguments": {"target": "@item3"}}';
      }
      async function* click4() {
        yield '{"name": "device_click", "arguments": {"target": "@item4"}}';
      }
      async function* click5() {
        yield '{"name": "device_click", "arguments": {"target": "@item5"}}';
      }
      async function* doneStream() {
        yield 'Finished clicking items successfully.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(click1())
        .mockReturnValueOnce(click2())
        .mockReturnValueOnce(click3())
        .mockReturnValueOnce(click4())
        .mockReturnValueOnce(click5())
        .mockReturnValueOnce(doneStream());

      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Success',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('Click through items', {
        onEvent: (ev) => events.push(ev),
      });

      const recoveryEvents = events.filter((e) => e.type === 'recovery');
      expect(recoveryEvents).toHaveLength(0);
      expect(result.completed).toBe(true);
      expect(result.finalResponse).toBe('Finished clicking items successfully.');
    });

    it('Finding 4 repro: wait recovery calls sleepFn, strips all loading markers, and resets wait counter', async () => {
      // 1. Test marker clearing covers all markers
      const richLoadingContent = 'Screen with CircularProgressIndicator, loading_spinner, desc="loading", is_loading, progress_bar';
      expect(isScreenLoading(richLoadingContent)).toBe(true);
      const cleared = clearLoadingMarkers(richLoadingContent);
      expect(isScreenLoading(cleared)).toBe(false);

      // 2. Test sleepFn is called during wait recovery
      const sleepFn = jest.fn().mockResolvedValue(undefined);
      async function* toolStream() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }
      async function* doneStream() {
        yield 'Loaded.';
      }
      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(doneStream());

      await runLocalAgentLoop('Wait task', {
        initialScreenContent: 'Screen tree: circularprogressindicator',
        waitMs: 123,
        sleepFn,
      });

      expect(sleepFn).toHaveBeenCalledWith(123);

      // 3. Test pathological all-wait run terminates after reaching MAX_TOTAL_RECOVERY_WAITS
      async function* endlessWaitStream() {
        yield '{"name": "device_screen_read", "arguments": {}}';
      }
      (localLlm.streamLocalLlmResponse as jest.Mock).mockImplementation(() => endlessWaitStream());
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Screen tree: state="loading"',
      });
      const pathologicalResult = await runLocalAgentLoop('Wait task', {
        initialScreenContent: 'Screen tree: state="loading"',
        waitMs: 0,
        sleepFn: jest.fn().mockResolvedValue(undefined),
      });
      expect(pathologicalResult.completed).toBe(false);
      expect(pathologicalResult.steps.filter((s) => s.recoveryAction === 'wait').length).toBe(MAX_TOTAL_RECOVERY_WAITS);
    });

    it('Finding 5 repro: prompt containing keyboard or loading keywords emits no recovery event before first observation', async () => {
      async function* toolStream() {
        yield '{"name": "device_click", "arguments": {"target": "@settings"}}';
      }
      async function* doneStream() {
        yield 'Opened settings successfully.';
      }

      (localLlm.streamLocalLlmResponse as jest.Mock)
        .mockReturnValueOnce(toolStream())
        .mockReturnValueOnce(doneStream());

      (safetyManager.evaluateSafety as jest.Mock).mockResolvedValue({
        status: 'success',
        result: 'allowed',
      });
      (deviceActionExecutor.executeDeviceAction as jest.Mock).mockResolvedValue({
        outcome: 'executed',
        observation: 'Success',
      });

      const events: any[] = [];
      const result = await runLocalAgentLoop('Help me change my Gboard settings and wait for the loading screen', {
        onEvent: (ev) => events.push(ev),
      });

      // No recovery event should have fired from the prompt before any screen observation
      const recoveryEvents = events.filter((e) => e.type === 'recovery');
      expect(recoveryEvents).toHaveLength(0);
      expect(result.completed).toBe(true);
      expect(result.finalResponse).toBe('Opened settings successfully.');
    });
  });
});

/**
 * Planner -> Needle bridge: a bigger local model plans, Needle drives the UI.
 * These tests pin the engine-swap contract (one engine at a time), the
 * transcript the planner reads back, and the honesty paths (no model, no
 * silent mock, planner always restored).
 */
import {
  formatNeedleTranscript,
  resolveNeedleAutomationModel,
  runNeedleDeviceAutomation,
  type NeedleAutomationDeps,
} from '../utils/needleAutomation';
import type { LocalAgentLoopResult } from '../utils/localAgentLoop';

const NEEDLE = 'Needle-3 (20-layer)';
const PLANNER = 'Qwen2.5 1.5B (GGUF)';

function loopResult(overrides: Partial<LocalAgentLoopResult> = {}): LocalAgentLoopResult {
  return {
    finalResponse: '',
    totalSteps: 1,
    completed: true,
    steps: [
      {
        step: 1,
        prompt: 'open settings',
        response: '{"type":"call","function_calls":[{"name":"device_open_app","arguments":{"app":"Settings"}}]}',
        toolCall: {
          toolName: 'device_open_app',
          target: 'Settings',
          raw: '{}',
          format: 'needle_json',
        },
        observation: 'Opened Settings',
        executionStatus: 'executed',
      },
    ],
    ...overrides,
  } as LocalAgentLoopResult;
}

function harness(overrides: Partial<NeedleAutomationDeps> = {}) {
  const calls: string[] = [];
  const deps: NeedleAutomationDeps = {
    isModelDownloaded: jest.fn(async (name: string) => name === NEEDLE),
    getLoadedModel: jest.fn(() => PLANNER),
    unloadModel: jest.fn(async () => {
      calls.push('unload');
    }),
    loadModel: jest.fn(async (name: string) => {
      calls.push(`load:${name}`);
    }),
    runLoop: jest.fn(async () => loopResult()),
    ...overrides,
  };
  return { deps, calls };
}

describe('resolveNeedleAutomationModel', () => {
  it('returns the downloaded .cact model', async () => {
    const { deps } = harness();
    await expect(resolveNeedleAutomationModel(deps)).resolves.toBe(NEEDLE);
  });

  it('returns null when nothing is downloaded', async () => {
    const { deps } = harness({ isModelDownloaded: jest.fn(async () => false) });
    await expect(resolveNeedleAutomationModel(deps)).resolves.toBeNull();
  });

  it('prefers the loaded engine when it is already a Needle model', async () => {
    const { deps } = harness({
      getLoadedModel: jest.fn(() => NEEDLE),
      isModelDownloaded: jest.fn(async () => false),
    });
    await expect(resolveNeedleAutomationModel(deps)).resolves.toBe(NEEDLE);
  });
});

describe('runNeedleDeviceAutomation', () => {
  it('parks the planner, runs Needle, then restores the planner', async () => {
    const { deps, calls } = harness();

    const result = await runNeedleDeviceAutomation('open Settings', { deps, conversationId: 'c1' });

    expect(result.ok).toBe(true);
    expect(result.model).toBe(NEEDLE);
    expect(calls).toEqual(['unload', `load:${NEEDLE}`, 'unload', `load:${PLANNER}`]);
    expect(deps.runLoop).toHaveBeenCalledWith('open Settings', {
      maxSteps: undefined,
      conversationId: 'c1',
    });
    expect(result.output).toContain('device_open_app (target=Settings) -> executed: Opened Settings');
    expect(result.output).toContain('Result: completed');
  });

  it('does not swap when the planner is already the Needle model', async () => {
    const { deps, calls } = harness({ getLoadedModel: jest.fn(() => NEEDLE) });

    const result = await runNeedleDeviceAutomation('open Settings', { deps });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
  });

  it('fails honestly when no Needle model is downloaded', async () => {
    const { deps, calls } = harness({ isModelDownloaded: jest.fn(async () => false) });

    const result = await runNeedleDeviceAutomation('open Settings', { deps });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('Needle-3 (20-layer)');
    expect(calls).toEqual([]);
    expect(deps.runLoop).not.toHaveBeenCalled();
  });

  it('passes the step budget through to the loop', async () => {
    const { deps } = harness();
    await runNeedleDeviceAutomation('open Settings', { deps, maxSteps: 4 });
    expect(deps.runLoop).toHaveBeenCalledWith('open Settings', {
      maxSteps: 4,
      conversationId: undefined,
    });
  });

  it('reports an engine load failure without running the loop', async () => {
    const { deps } = harness({
      loadModel: jest.fn(async () => {
        throw new Error('needle_load: failed to load .cact model');
      }),
    });

    const result = await runNeedleDeviceAutomation('open Settings', { deps });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('needle_load');
    expect(deps.runLoop).not.toHaveBeenCalled();
  });

  it('restores the planner even when the loop throws', async () => {
    const { deps, calls } = harness({
      runLoop: jest.fn(async () => {
        throw new Error('device exploded');
      }),
    });

    const result = await runNeedleDeviceAutomation('open Settings', { deps });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('device exploded');
    expect(calls).toEqual(['unload', `load:${NEEDLE}`, 'unload', `load:${PLANNER}`]);
  });

  it('rejects an empty instruction before touching the engine', async () => {
    const { deps, calls } = harness();
    const result = await runNeedleDeviceAutomation('   ', { deps });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('formatNeedleTranscript', () => {
  it('marks an unfinished run and renders refusals', () => {
    const text = formatNeedleTranscript(
      loopResult({
        completed: false,
        steps: [
          { step: 1, prompt: 'do it', response: 'I cannot do that.', toolCall: undefined } as any,
        ],
      })
    );

    expect(text).toContain('1. (no tool call) I cannot do that.');
    expect(text).toContain('Result: stopped after 1 step(s) without finishing.');
  });
});

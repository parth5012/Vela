import { resolveTaskMode, runTask, TaskRunInput } from '../taskRunner';
import { useConfigStore } from '../../store/useConfigStore';
import * as localLlm from '../localLlm';
import * as providers from '../providers';

let mockIsLocalModelLoaded = true;

jest.mock('../localLlm', () => ({
  streamLocalLlmResponse: jest.fn(),
  initializeLocalModel: jest.fn(),
  get isLocalModelLoaded() {
    return mockIsLocalModelLoaded;
  },
}));

jest.mock('../providers', () => ({
  streamCloudResponse: jest.fn(),
}));

describe('taskRunner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLocalModelLoaded = true;
    global.fetch = jest.fn();
    useConfigStore.setState({
      connectionMode: 'server',
      apiUrl: 'https://api.vela.test',
      apiKey: 'test-server-key',
      localModelName: 'DeepSeek-R1 1.5B (GGUF)',
      activeCloudProvider: 'gemini',
      cloudProviders: {
        gemini: { model: 'gemini-1.5-flash' },
        openai: { model: 'gpt-4o-mini' },
        anthropic: { model: 'claude-3-5-sonnet-20241022' },
        openrouter: { model: 'anthropic/claude-3.5-sonnet' },
        groq: { model: 'llama-3.3-70b-versatile' },
        custom: { model: 'custom-model', baseUrl: 'https://custom.ai/v1' },
      },
      cloudApiKeys: {
        gemini: 'test-gemini-key',
      },
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('resolveTaskMode (inherit vs pinned)', () => {
    it('inherits useConfigStore.connectionMode when task has no mode and argument omitted', () => {
      const task: TaskRunInput = {
        id: 't-1',
        title: 'Morning Briefing',
        task_prompt: 'Summarize news',
      };

      useConfigStore.setState({ connectionMode: 'server' });
      expect(resolveTaskMode(task)).toBe('server');

      useConfigStore.setState({ connectionMode: 'local' });
      expect(resolveTaskMode(task)).toBe('local');

      useConfigStore.setState({ connectionMode: 'cloud' });
      expect(resolveTaskMode(task)).toBe('cloud');
    });

    it('inherits useConfigStore.connectionMode when task.connection_mode is null', () => {
      const task: TaskRunInput = {
        id: 't-1',
        title: 'Morning Briefing',
        task_prompt: 'Summarize news',
        connection_mode: null,
      };

      useConfigStore.setState({ connectionMode: 'local' });
      expect(resolveTaskMode(task)).toBe('local');

      useConfigStore.setState({ connectionMode: 'cloud' });
      expect(resolveTaskMode(task)).toBe('cloud');
    });

    it('inherits useConfigStore.connectionMode when taskMode argument is explicitly null and task has no mode', () => {
      const task: TaskRunInput = {
        id: 't-1',
        title: 'Morning Briefing',
        task_prompt: 'Summarize news',
      };

      useConfigStore.setState({ connectionMode: 'cloud' });
      expect(resolveTaskMode(task, null)).toBe('cloud');
    });

    it('returns pinned task.connection_mode when taskMode argument is explicitly null', () => {
      useConfigStore.setState({ connectionMode: 'server' });

      const localTask: TaskRunInput = {
        id: 't-local',
        title: 'Local Task',
        task_prompt: 'Prompt',
        connection_mode: 'local',
      };
      expect(resolveTaskMode(localTask, null)).toBe('local');

      const cloudTask: TaskRunInput = {
        id: 't-cloud',
        title: 'Cloud Task',
        task_prompt: 'Prompt',
        connection_mode: 'cloud',
      };
      expect(resolveTaskMode(cloudTask, null)).toBe('cloud');
    });

    it('honors pinned task.connection_mode over useConfigStore default', () => {
      useConfigStore.setState({ connectionMode: 'server' });

      const localTask: TaskRunInput = {
        id: 't-local',
        title: 'Local Task',
        task_prompt: 'Prompt',
        connection_mode: 'local',
      };
      expect(resolveTaskMode(localTask)).toBe('local');

      const cloudTask: TaskRunInput = {
        id: 't-cloud',
        title: 'Cloud Task',
        task_prompt: 'Prompt',
        connection_mode: 'cloud',
      };
      expect(resolveTaskMode(cloudTask)).toBe('cloud');
    });

    it('honors explicit taskMode argument over task property and config store', () => {
      useConfigStore.setState({ connectionMode: 'server' });

      const task: TaskRunInput = {
        id: 't-1',
        title: 'Task',
        task_prompt: 'Prompt',
        connection_mode: 'cloud',
      };

      expect(resolveTaskMode(task, 'local')).toBe('local');
      expect(resolveTaskMode(task, 'server')).toBe('server');
    });

    it('handles undefined/null task input gracefully', () => {
      useConfigStore.setState({ connectionMode: 'local' });
      expect(resolveTaskMode(undefined)).toBe('local');
      expect(resolveTaskMode(null)).toBe('local');
      expect(resolveTaskMode(null, 'cloud')).toBe('cloud');
    });
  });

  describe('three dispatch branches', () => {
    const baseTask: TaskRunInput = {
      id: 'task-123',
      title: 'Analyze Code',
      task_prompt: 'Check for potential regressions in repo',
      linked_agent: 'code reviewer',
    };

    it('dispatches to server POST /api/tasks/run with exact body shape and Bearer auth', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          output: 'Analysis complete: No regressions found.',
        }),
      });

      const output = await runTask(baseTask, 'server');

      expect(output).toBe('Analysis complete: No regressions found.');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('https://api.vela.test/api/tasks/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-server-key',
        },
        body: JSON.stringify({
          task_id: 'task-123',
          title: 'Analyze Code',
          prompt: 'Check for potential regressions in repo',
          agent: 'code reviewer',
        }),
      });
    });

    it('dispatches to server with default agent when linked_agent is absent', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          output: 'Default agent completed run.',
        }),
      });

      const taskWithoutAgent: TaskRunInput = {
        id: 'task-456',
        title: 'Daily Digest',
        task_prompt: 'Digest news',
      };

      const output = await runTask(taskWithoutAgent, 'server');
      expect(output).toBe('Default agent completed run.');

      const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(sentBody.agent).toBe('personal assistant');
    });

    it('throws when server returns HTTP error status', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 502,
      });

      await expect(runTask(baseTask, 'server')).rejects.toThrow('HTTP Error: 502');
    });

    it('throws when server response status is not success', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'error',
          output: 'Prompt failed validation',
        }),
      });

      await expect(runTask(baseTask, 'server')).rejects.toThrow('Prompt failed validation');
    });

    it('dispatches to local streamLocalLlmResponse and accumulates streamed tokens', async () => {
      async function* mockStream() {
        yield 'Local ';
        yield 'generation ';
        yield 'output.';
      }
      (localLlm.streamLocalLlmResponse as jest.Mock).mockReturnValueOnce(mockStream());

      const output = await runTask(baseTask, 'local');

      expect(output).toBe('Local generation output.');
      expect(localLlm.streamLocalLlmResponse).toHaveBeenCalledWith(baseTask.task_prompt);
    });

    it('awaits initializeLocalModel before streaming when model is not loaded', async () => {
      mockIsLocalModelLoaded = false;
      const callOrder: string[] = [];

      (localLlm.initializeLocalModel as jest.Mock).mockImplementationOnce(async () => {
        callOrder.push('initialize');
        mockIsLocalModelLoaded = true;
      });

      async function* mockStream() {
        callOrder.push('stream');
        yield 'Cold start completed.';
      }
      (localLlm.streamLocalLlmResponse as jest.Mock).mockReturnValueOnce(mockStream());

      const output = await runTask(baseTask, 'local');

      expect(output).toBe('Cold start completed.');
      expect(localLlm.initializeLocalModel).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['initialize', 'stream']);
    });

    it('fails fast with human-readable reason when initializeLocalModel fails', async () => {
      mockIsLocalModelLoaded = false;
      (localLlm.initializeLocalModel as jest.Mock).mockRejectedValueOnce(
        new Error('No downloaded model found for "DeepSeek-R1 1.5B (GGUF)". Download it in Settings first.')
      );

      await expect(runTask(baseTask, 'local')).rejects.toThrow(
        'Mode "local" not configured: No downloaded model found for "DeepSeek-R1 1.5B (GGUF)". Download it in Settings first.'
      );
      expect(localLlm.streamLocalLlmResponse).not.toHaveBeenCalled();
    });

    it('propagates errors from local streamLocalLlmResponse', async () => {
      async function* throwingStream() {
        yield 'Partial';
        throw new Error('Local inference interrupted');
      }
      (localLlm.streamLocalLlmResponse as jest.Mock).mockReturnValueOnce(throwingStream());

      await expect(runTask(baseTask, 'local')).rejects.toThrow('Local inference interrupted');
    });

    it('dispatches to cloud streamCloudResponse and accumulates emitted tokens', async () => {
      (providers.streamCloudResponse as jest.Mock).mockImplementationOnce(async (options: any) => {
        options.onToken('Cloud ');
        options.onToken('model ');
        options.onToken('completed.');
        options.onDone();
      });

      const output = await runTask(baseTask, 'cloud');

      expect(output).toBe('Cloud model completed.');
      expect(providers.streamCloudResponse).toHaveBeenCalledWith({
        provider: 'gemini',
        apiKey: 'test-gemini-key',
        model: 'gemini-1.5-flash',
        baseUrl: undefined,
        temperature: 0.7,
        messages: [{ role: 'user', content: baseTask.task_prompt }],
        onToken: expect.any(Function),
        onDone: expect.any(Function),
        onError: expect.any(Function),
      });
    });

    it('propagates errors from cloud streamCloudResponse onError', async () => {
      (providers.streamCloudResponse as jest.Mock).mockImplementationOnce(async (options: any) => {
        options.onError(new Error('Rate limit exceeded (429)'));
      });

      await expect(runTask(baseTask, 'cloud')).rejects.toThrow('Rate limit exceeded (429)');
    });
  });

  describe('fail-fast validation paths (no cross-mode fallback)', () => {
    const task: TaskRunInput = {
      id: 'task-failfast',
      title: 'Fail Fast Test',
      task_prompt: 'Run something',
    };

    it('fails fast on server mode when apiUrl is missing', async () => {
      useConfigStore.setState({ apiUrl: '', apiKey: 'some-key' });

      await expect(runTask(task, 'server')).rejects.toThrow(
        'Mode "server" not configured: no apiUrl or apiKey'
      );
      expect(global.fetch).not.toHaveBeenCalled();
      expect(localLlm.streamLocalLlmResponse).not.toHaveBeenCalled();
      expect(providers.streamCloudResponse).not.toHaveBeenCalled();
    });

    it('fails fast on server mode when apiKey is missing', async () => {
      useConfigStore.setState({ apiUrl: 'https://api.vela.test', apiKey: '' });

      await expect(runTask(task, 'server')).rejects.toThrow(
        'Mode "server" not configured: no apiUrl or apiKey'
      );
      expect(global.fetch).not.toHaveBeenCalled();
      expect(localLlm.streamLocalLlmResponse).not.toHaveBeenCalled();
      expect(providers.streamCloudResponse).not.toHaveBeenCalled();
    });

    it('fails fast on local mode when localModelName is missing', async () => {
      useConfigStore.setState({ localModelName: '' });

      await expect(runTask(task, 'local')).rejects.toThrow(
        'Mode "local" not configured: no local model configured'
      );
      expect(localLlm.streamLocalLlmResponse).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(providers.streamCloudResponse).not.toHaveBeenCalled();
    });

    it('fails fast on cloud mode when active cloud provider API key is missing', async () => {
      useConfigStore.setState({
        activeCloudProvider: 'anthropic',
        cloudApiKeys: {},
      });

      await expect(runTask(task, 'cloud')).rejects.toThrow(
        'Mode "cloud" not configured: no cloud provider key'
      );
      expect(providers.streamCloudResponse).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(localLlm.streamLocalLlmResponse).not.toHaveBeenCalled();
    });

    it('fails fast on cloud mode when custom provider has no baseUrl', async () => {
      useConfigStore.setState({
        activeCloudProvider: 'custom',
        cloudProviders: {
          custom: { model: 'custom-model', baseUrl: '' },
        } as any,
        cloudApiKeys: {
          custom: 'sk-custom-key',
        },
      });

      await expect(runTask(task, 'cloud')).rejects.toThrow(
        'Mode "cloud" not configured: custom provider requires baseUrl'
      );
      expect(providers.streamCloudResponse).not.toHaveBeenCalled();
    });

    it('fails fast on cloud mode when custom provider has no model', async () => {
      useConfigStore.setState({
        activeCloudProvider: 'custom',
        cloudProviders: {
          custom: { model: '', baseUrl: 'https://custom.ai/v1' },
        } as any,
        cloudApiKeys: {
          custom: 'sk-custom-key',
        },
      });

      await expect(runTask(task, 'cloud')).rejects.toThrow(
        'Mode "cloud" not configured: custom provider requires a model'
      );
      expect(providers.streamCloudResponse).not.toHaveBeenCalled();
    });
  });
});

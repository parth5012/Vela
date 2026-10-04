import { ConnectionMode, useConfigStore, DEFAULT_CLOUD_PROVIDERS } from '../store/useConfigStore';
import { streamLocalLlmResponse, initializeLocalModel, isLocalModelLoaded } from './localLlm';
import { streamCloudResponse } from './providers';

export interface TaskRunInput {
  id: string;
  title: string;
  task_prompt: string;
  linked_agent?: string | null;
  connection_mode?: 'server' | 'local' | 'cloud' | null;
}

export function resolveTaskMode(
  task?: { connection_mode?: 'server' | 'local' | 'cloud' | null } | null,
  taskMode?: string | null
): ConnectionMode {
  const mode = taskMode ?? task?.connection_mode;
  if (mode === 'server' || mode === 'local' || mode === 'cloud') {
    return mode;
  }
  const configMode = useConfigStore.getState().connectionMode;
  if (configMode === 'server' || configMode === 'local' || configMode === 'cloud') {
    return configMode;
  }
  return 'server';
}

export async function runTask(
  task: TaskRunInput,
  taskMode?: string | null
): Promise<string> {
  const mode = resolveTaskMode(task, taskMode);

  if (mode === 'server') {
    const { apiUrl, apiKey } = useConfigStore.getState();
    if (!apiUrl || !apiKey) {
      throw new Error('Mode "server" not configured: no apiUrl or apiKey');
    }

    const response = await fetch(`${apiUrl}/api/tasks/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        task_id: task.id,
        title: task.title,
        prompt: task.task_prompt,
        agent: task.linked_agent || 'personal assistant',
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    if (data.status === 'success') {
      return data.output ?? '';
    }
    throw new Error(data.output || 'Unknown backend error');
  }

  if (mode === 'local') {
    const { localModelName } = useConfigStore.getState();
    if (!localModelName) {
      throw new Error('Mode "local" not configured: no local model configured');
    }

    if (!isLocalModelLoaded) {
      try {
        await initializeLocalModel();
      } catch (initErr: any) {
        throw new Error(`Mode "local" not configured: ${initErr?.message || 'failed to initialize local model'}`);
      }
    }

    const generator = streamLocalLlmResponse(task.task_prompt);
    let output = '';
    for await (const chunk of generator) {
      output += chunk;
    }
    return output;
  }

  if (mode === 'cloud') {
    const config = useConfigStore.getState();
    const provider = config.activeCloudProvider || 'gemini';
    const providerConfig = config.cloudProviders?.[provider];
    const apiKey = config.cloudApiKeys?.[provider];

    if (!apiKey || !apiKey.trim()) {
      throw new Error('Mode "cloud" not configured: no cloud provider key');
    }

    if (provider === 'custom' && (!providerConfig?.baseUrl || !providerConfig.baseUrl.trim())) {
      throw new Error('Mode "cloud" not configured: custom provider requires baseUrl');
    }

    if (provider === 'custom' && (!providerConfig?.model || !providerConfig.model.trim())) {
      throw new Error('Mode "cloud" not configured: custom provider requires a model');
    }

    const model = providerConfig?.model || DEFAULT_CLOUD_PROVIDERS[provider]?.model || 'gemini-1.5-flash';
    let output = '';

    await new Promise<void>((resolve, reject) => {
      streamCloudResponse({
        provider,
        apiKey: apiKey.trim(),
        model,
        baseUrl: providerConfig?.baseUrl,
        temperature: typeof config.temperature === 'number' ? config.temperature : 0.7,
        messages: [{ role: 'user', content: task.task_prompt }],
        onToken: (token) => {
          output += token;
        },
        onDone: () => {
          resolve();
        },
        onError: (err) => {
          reject(err);
        },
      }).catch(reject);
    });

    return output;
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

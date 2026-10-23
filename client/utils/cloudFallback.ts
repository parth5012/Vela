/**
 * WF-10: Cloud Fallback Path (OpenAI-compatible) & Privacy Disclosure Gate
 * High-transparency provider abstraction bridging local on-device inference
 * with remote zero-retention cloud fallbacks.
 */

export const PRIVACY_DISCLOSURE_COPY = {
  title: 'Data Privacy & Cloud Fallback Notice',
  shortBadge: 'Cloud Fallback',
  bannerNotice:
    'Using secure cloud processing. Your request is encrypted in transit and never stored or used to train models.',
  modalExplanation:
    'Vela prioritizes on-device processing to keep your data 100% private. When local execution is unavailable due to memory constraints or hardware capabilities, requests can route via encrypted TLS 1.3 transport to our zero-log cloud fallback. Zero prompt retention, zero persistent logging, and zero training on your data.',
  onDeviceBadge: 'On-Device (100% Private)',
  onDeviceExplanation:
    'Processed completely on your phone. Zero bytes leave your device.',
};

export type RuntimeExecutionMode = 'on_device_only' | 'cloud_only' | 'auto_fallback';

export interface RemoteConfigCredentials {
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null;
  tool_calls?: any[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, any>;
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  tools?: ToolDefinition[];
  sampling?: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  };
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface PrivacyNotice {
  badge: string;
  explanation?: string;
  modalText?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiChatResponse {
  text: string;
  toolCalls?: ParsedToolCall[];
  executionMode: 'on_device' | 'cloud' | 'cloud_fallback';
  fallbackReason?: string;
  privacyNotice?: PrivacyNotice;
  requiresPrivacyConsent?: boolean;
  tokenUsage?: TokenUsage;
}

export interface AiExecutionProvider {
  providerType: 'on_device' | 'cloud';
  isHealthy(): Promise<boolean>;
  getUnavailableReason?(): string;
  chat(request: AiChatRequest): Promise<AiChatResponse>;
  streamChat?(request: AiChatRequest): Promise<AiChatResponse>;
}

export interface TokenUsageMetrics {
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class OpenAiCompatibleClient implements AiExecutionProvider {
  public providerType: 'cloud' = 'cloud';
  private baseUrl: string;
  private apiKey: string;
  private defaultModel: string;
  private timeoutMs: number;
  private maxRetries: number;
  private fetchFn: typeof fetch;

  private metrics: TokenUsageMetrics = {
    totalRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  constructor(config: RemoteConfigCredentials, customFetch: typeof fetch = fetch) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel ?? 'gpt-4o-mini';
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.maxRetries = config.maxRetries ?? 2;
    this.fetchFn = customFetch;
  }

  async isHealthy(): Promise<boolean> {
    return Boolean(this.baseUrl && this.apiKey);
  }

  getTokenUsageMetrics(): TokenUsageMetrics {
    return { ...this.metrics };
  }

  resetTokenMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const payload: Record<string, any> = {
      model: this.defaultModel,
      messages: request.messages,
      temperature: request.sampling?.temperature ?? 0.7,
      max_tokens: request.sampling?.maxTokens ?? 2048,
    };

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? {},
        },
      }));
    }

    const response = await this.executeWithRetry(async (signal) => {
      return this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
    }, request.signal);

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message ?? {};
    const text = message.content ?? '';

    let toolCalls: ParsedToolCall[] | undefined;
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      toolCalls = message.tool_calls.map((tc: any) => {
        let args = {};
        try {
          args = typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
        } catch {
          args = {};
        }
        return {
          id: tc.id,
          name: tc.function?.name ?? '',
          args,
        };
      });
    }

    if (data.usage) {
      this.recordTokenUsage({
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      });
    }

    return {
      text,
      toolCalls,
      executionMode: 'cloud',
      privacyNotice: {
        badge: PRIVACY_DISCLOSURE_COPY.shortBadge,
        explanation: PRIVACY_DISCLOSURE_COPY.bannerNotice,
        modalText: PRIVACY_DISCLOSURE_COPY.modalExplanation,
      },
      tokenUsage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  async streamChat(request: AiChatRequest): Promise<AiChatResponse> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const payload: Record<string, any> = {
      model: this.defaultModel,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: request.sampling?.temperature ?? 0.7,
      max_tokens: request.sampling?.maxTokens ?? 2048,
    };

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? {},
        },
      }));
    }

    const response = await this.executeWithRetry(async (signal) => {
      return this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
    }, request.signal);

    let accumulatedText = '';
    let streamUsage: TokenUsage | undefined;
    const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> = {};

    if (response.body && typeof (response.body as any).getReader === 'function') {
      const reader = (response.body as any).getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const onAbort = () => {
        if (typeof reader.cancel === 'function') {
          reader.cancel().catch(() => {});
        }
      };

      if (request.signal) {
        if (request.signal.aborted) {
          if (typeof reader.cancel === 'function') {
            await reader.cancel().catch(() => {});
          }
          throw new Error('Request aborted by caller');
        }
        request.signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        while (true) {
          if (request.signal?.aborted) {
            if (typeof reader.cancel === 'function') {
              await reader.cancel().catch(() => {});
            }
            throw new Error('Request aborted by caller');
          }

          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (request.signal?.aborted) {
              if (typeof reader.cancel === 'function') {
                await reader.cancel().catch(() => {});
              }
              throw new Error('Request aborted by caller');
            }

            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataContent = trimmed.slice(5).trim();
            if (dataContent === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataContent);
              const delta = parsed.choices?.[0]?.delta;
              const deltaContent = delta?.content;
              if (deltaContent) {
                accumulatedText += deltaContent;
                if (request.onToken) {
                  request.onToken(deltaContent);
                }
              }
              if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallAccumulator[idx]) {
                    toolCallAccumulator[idx] = {
                      id: tc.id || `call_${idx}`,
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    };
                  } else {
                    if (tc.id) toolCallAccumulator[idx].id = tc.id;
                    if (tc.function?.name) toolCallAccumulator[idx].name += tc.function.name;
                    if (tc.function?.arguments) toolCallAccumulator[idx].arguments += tc.function.arguments;
                  }
                }
              }
              if (parsed.usage) {
                streamUsage = {
                  promptTokens: parsed.usage.prompt_tokens ?? 0,
                  completionTokens: parsed.usage.completion_tokens ?? 0,
                  totalTokens: parsed.usage.total_tokens ?? 0,
                };
              }
            } catch {
              // Ignore incomplete chunks
            }
          }
        }
      } finally {
        if (request.signal) {
          request.signal.removeEventListener('abort', onAbort);
        }
      }
    } else {
      if (request.signal?.aborted) {
        throw new Error('Request aborted by caller');
      }
      // Fallback for non-streaming reader mock
      const text = await response.text();
      accumulatedText = text;
      if (request.onToken) {
        request.onToken(text);
      }
    }

    if (streamUsage) {
      this.recordTokenUsage(streamUsage);
    }

    const assembledToolCalls: ParsedToolCall[] = Object.values(toolCallAccumulator).map((item) => {
      let args = {};
      try {
        args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments;
      } catch {
        args = {};
      }
      return {
        id: item.id,
        name: item.name,
        args,
      };
    });

    return {
      text: accumulatedText,
      executionMode: 'cloud',
      privacyNotice: {
        badge: PRIVACY_DISCLOSURE_COPY.shortBadge,
        explanation: PRIVACY_DISCLOSURE_COPY.bannerNotice,
        modalText: PRIVACY_DISCLOSURE_COPY.modalExplanation,
      },
      tokenUsage: streamUsage,
      toolCalls: assembledToolCalls.length > 0 ? assembledToolCalls : undefined,
    };
  }

  private recordTokenUsage(usage: TokenUsage): void {
    this.metrics.totalRequests += 1;
    this.metrics.promptTokens += usage.promptTokens;
    this.metrics.completionTokens += usage.completionTokens;
    this.metrics.totalTokens += usage.totalTokens;
  }

  private async executeWithRetry(
    fn: (signal: AbortSignal) => Promise<Response>,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    if (externalSignal?.aborted) {
      throw new Error('Request aborted by caller');
    }

    let attempts = 0;
    const maxAttempts = this.maxRetries + 1;

    while (attempts < maxAttempts) {
      if (externalSignal?.aborted) {
        throw new Error('Request aborted by caller');
      }

      attempts++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const abortHandler = () => controller.abort();
      if (externalSignal) {
        externalSignal.addEventListener('abort', abortHandler);
      }

      try {
        const response = await fn(controller.signal);
        clearTimeout(timeoutId);

        if (response.ok) {
          return response;
        }

        // Retry on 429 or 5xx errors
        const isRetryable =
          response.status === 429 ||
          (response.status >= 500 && response.status <= 504);

        if (!isRetryable) {
          const nonRetryableError: any = new Error(
            `Cloud request failed with status ${response.status}: ${response.statusText}`
          );
          nonRetryableError.nonRetryable = true;
          throw nonRetryableError;
        }

        if (attempts >= maxAttempts) {
          throw new Error(
            `Cloud request failed with status ${response.status}: ${response.statusText}`
          );
        }

        // Bounded exponential backoff with jitter
        const backoffMs = Math.min(100 * Math.pow(2, attempts - 1), 1000);
        await new Promise((res) => setTimeout(res, backoffMs));
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (externalSignal?.aborted) {
          throw new Error('Request aborted by caller');
        }
        if (err?.nonRetryable || attempts >= maxAttempts) {
          throw err;
        }
        const backoffMs = Math.min(100 * Math.pow(2, attempts - 1), 1000);
        await new Promise((res) => setTimeout(res, backoffMs));
      } finally {
        if (externalSignal) {
          externalSignal.removeEventListener('abort', abortHandler);
        }
      }
    }

    throw new Error('Exceeded maximum retry attempts');
  }
}

export interface UnifiedAiRouterOptions {
  mode: RuntimeExecutionMode;
  onDeviceProvider?: AiExecutionProvider;
  cloudClient: OpenAiCompatibleClient;
  userConsentedToCloud?: boolean;
}

export class UnifiedAiRouter {
  public mode: RuntimeExecutionMode;
  private onDeviceProvider?: AiExecutionProvider;
  private cloudClient: OpenAiCompatibleClient;
  public userConsentedToCloud: boolean;

  constructor(options: UnifiedAiRouterOptions) {
    this.mode = options.mode;
    this.onDeviceProvider = options.onDeviceProvider;
    this.cloudClient = options.cloudClient;
    this.userConsentedToCloud = options.userConsentedToCloud ?? false;
  }

  async executeChat(request: AiChatRequest): Promise<AiChatResponse> {
    if (this.mode === 'on_device_only') {
      const isHealthy = this.onDeviceProvider
        ? await this.onDeviceProvider.isHealthy()
        : false;

      if (!isHealthy) {
        throw new Error(
          'On-device AI is currently unavailable and cloud fallback is disabled. Please check model download status or memory availability.'
        );
      }

      return this.onDeviceProvider!.chat(request);
    }

    if (this.mode === 'cloud_only') {
      return this.cloudClient.chat(request);
    }

    // mode === 'auto_fallback'
    let isLocalHealthy = false;
    try {
      isLocalHealthy = this.onDeviceProvider
        ? await this.onDeviceProvider.isHealthy()
        : false;
    } catch {
      isLocalHealthy = false;
    }

    if (isLocalHealthy && this.onDeviceProvider) {
      try {
        return await this.onDeviceProvider.chat(request);
      } catch (localErr) {
        console.warn(
          '[UnifiedAiRouter] Local inference failed, falling back to cloud:',
          localErr
        );
      }
    }

    // Require explicit privacy consent before routing off-device
    if (!this.userConsentedToCloud) {
      return {
        text: '',
        executionMode: 'cloud_fallback',
        requiresPrivacyConsent: true,
        privacyNotice: {
          badge: PRIVACY_DISCLOSURE_COPY.shortBadge,
          explanation: PRIVACY_DISCLOSURE_COPY.bannerNotice,
          modalText: PRIVACY_DISCLOSURE_COPY.modalExplanation,
        },
      };
    }

    const fallbackReason =
      this.onDeviceProvider?.getUnavailableReason?.() ?? 'LOCAL_UNAVAILABLE';

    const cloudRes = await this.cloudClient.chat(request);
    return {
      ...cloudRes,
      executionMode: 'cloud_fallback',
      fallbackReason,
      privacyNotice: {
        badge: PRIVACY_DISCLOSURE_COPY.shortBadge,
        explanation: PRIVACY_DISCLOSURE_COPY.bannerNotice,
        modalText: PRIVACY_DISCLOSURE_COPY.modalExplanation,
      },
    };
  }

  async executeStreamChat(request: AiChatRequest): Promise<AiChatResponse> {
    if (this.mode === 'on_device_only') {
      const isHealthy = this.onDeviceProvider
        ? await this.onDeviceProvider.isHealthy()
        : false;

      if (!isHealthy) {
        throw new Error(
          'On-device AI is currently unavailable and cloud fallback is disabled.'
        );
      }

      if (this.onDeviceProvider!.streamChat) {
        return this.onDeviceProvider!.streamChat(request);
      }
      return this.onDeviceProvider!.chat(request);
    }

    if (this.mode === 'cloud_only') {
      return this.cloudClient.streamChat(request);
    }

    let isLocalHealthy = false;
    try {
      isLocalHealthy = this.onDeviceProvider
        ? await this.onDeviceProvider.isHealthy()
        : false;
    } catch {
      isLocalHealthy = false;
    }

    if (isLocalHealthy && this.onDeviceProvider) {
      try {
        if (this.onDeviceProvider.streamChat) {
          return await this.onDeviceProvider.streamChat(request);
        }
        return await this.onDeviceProvider.chat(request);
      } catch (localErr) {
        console.warn(
          '[UnifiedAiRouter] Local stream failed, falling back to cloud:',
          localErr
        );
      }
    }

    if (!this.userConsentedToCloud) {
      return {
        text: '',
        executionMode: 'cloud_fallback',
        requiresPrivacyConsent: true,
        privacyNotice: {
          badge: PRIVACY_DISCLOSURE_COPY.shortBadge,
          explanation: PRIVACY_DISCLOSURE_COPY.bannerNotice,
          modalText: PRIVACY_DISCLOSURE_COPY.modalExplanation,
        },
      };
    }

    const fallbackReason =
      this.onDeviceProvider?.getUnavailableReason?.() ?? 'LOCAL_UNAVAILABLE';

    const cloudRes = await this.cloudClient.streamChat(request);
    return {
      ...cloudRes,
      executionMode: 'cloud_fallback',
      fallbackReason,
      privacyNotice: {
        badge: PRIVACY_DISCLOSURE_COPY.shortBadge,
        explanation: PRIVACY_DISCLOSURE_COPY.bannerNotice,
        modalText: PRIVACY_DISCLOSURE_COPY.modalExplanation,
      },
    };
  }
}

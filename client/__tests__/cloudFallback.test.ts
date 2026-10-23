/**
 * WF-10: Cloud Fallback Path (OpenAI-compatible) & Privacy Disclosure Gate
 * Contract tests covering unified provider abstraction, OpenAI-compatible streaming,
 * token metering, timeout/retry mechanics, runtime selection, and privacy copy gates.
 */

import {
  OpenAiCompatibleClient,
  UnifiedAiRouter,
  PRIVACY_DISCLOSURE_COPY,
  type AiChatRequest,
  type AiChatResponse,
  type AiExecutionProvider,
  type RemoteConfigCredentials,
  type RuntimeExecutionMode,
} from '../utils/cloudFallback';

describe('WF-10: Cloud Fallback Path & Privacy Disclosure Gate', () => {
  let mockFetch: jest.Mock;
  const mockRemoteConfig: RemoteConfigCredentials = {
    baseUrl: 'https://api.vela.ai/v1',
    apiKey: 'sk-remote-config-dynamic-key',
    defaultModel: 'gpt-4o-mini',
    timeoutMs: 5000,
    maxRetries: 2,
  };

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  describe('Privacy Disclosure Copy Constants (Decision 4 & WF-01)', () => {
    it('provides standardized, hardened privacy strings adhering to product decisions', () => {
      expect(PRIVACY_DISCLOSURE_COPY.shortBadge).toBe('Cloud Fallback');
      expect(PRIVACY_DISCLOSURE_COPY.bannerNotice).toContain('encrypted in transit');
      expect(PRIVACY_DISCLOSURE_COPY.bannerNotice).toContain('never stored or used to train models');
      expect(PRIVACY_DISCLOSURE_COPY.modalExplanation).toContain('zero-log cloud fallback');
      expect(PRIVACY_DISCLOSURE_COPY.modalExplanation).toContain('Zero prompt retention');
      expect(PRIVACY_DISCLOSURE_COPY.onDeviceBadge).toContain('On-Device (100% Private)');
      expect(PRIVACY_DISCLOSURE_COPY.onDeviceExplanation).toContain('Zero bytes leave your device');
    });
  });

  describe('OpenAI-Compatible Remote Client', () => {
    it('sends well-formed chat completion request with authorization and models', async () => {
      const client = new OpenAiCompatibleClient(mockRemoteConfig, mockFetch);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-123',
          choices: [
            {
              message: { role: 'assistant', content: 'Cloud response message.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
        }),
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Hello cloud!' }],
      });

      expect(response.text).toBe('Cloud response message.');
      expect(response.executionMode).toBe('cloud');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vela.ai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-remote-config-dynamic-key',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('streams SSE chunks and accumulates response text with onToken callbacks', async () => {
      const client = new OpenAiCompatibleClient(mockRemoteConfig, mockFetch);

      // Simulated SSE stream
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" from"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" stream!"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n',
        'data: [DONE]\n\n',
      ];

      let streamIndex = 0;
      const mockReader = {
        read: jest.fn().mockImplementation(async () => {
          if (streamIndex < sseChunks.length) {
            const chunk = sseChunks[streamIndex++];
            return { value: new TextEncoder().encode(chunk), done: false };
          }
          return { value: undefined, done: true };
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const tokens: string[] = [];
      const streamRes = await client.streamChat({
        messages: [{ role: 'user', content: 'Test stream' }],
        onToken: (tok) => tokens.push(tok),
      });

      expect(streamRes.text).toBe('Hello from stream!');
      expect(tokens).toEqual(['Hello', ' from', ' stream!']);
      expect(client.getTokenUsageMetrics().totalTokens).toBe(13);
    });

    it('extracts OpenAI structured tool calls correctly', async () => {
      const client = new OpenAiCompatibleClient(mockRemoteConfig, mockFetch);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_abc123',
                    type: 'function',
                    function: {
                      name: 'set_alarm',
                      arguments: '{"time":"07:30","label":"Workout"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        }),
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Set an alarm for 7:30 AM' }],
        tools: [
          {
            name: 'set_alarm',
            description: 'Set device alarm',
            parameters: {},
          },
        ],
      });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].name).toBe('set_alarm');
      expect(response.toolCalls?.[0].args).toEqual({
        time: '07:30',
        label: 'Workout',
      });
    });

    it('retries on retryable 5xx/429 status codes with bounded attempts', async () => {
      const client = new OpenAiCompatibleClient(
        { ...mockRemoteConfig, maxRetries: 2 },
        mockFetch
      );

      // 1st call fails 503, 2nd call succeeds 200
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: 'Recovered!' } }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        });

      const res = await client.chat({
        messages: [{ role: 'user', content: 'Retry test' }],
      });

      expect(res.text).toBe('Recovered!');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('fails immediately without retrying on non-retryable 4xx client errors', async () => {
      const client = new OpenAiCompatibleClient(
        { ...mockRemoteConfig, maxRetries: 3 },
        mockFetch
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(
        client.chat({ messages: [{ role: 'user', content: 'Auth test' }] })
      ).rejects.toThrow('Cloud request failed with status 401');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('serializes tool definitions in streaming requests', async () => {
      const client = new OpenAiCompatibleClient(mockRemoteConfig, mockFetch);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                const chunk = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
                return { done: false, value: new TextEncoder().encode(chunk) };
              },
            };
          },
        },
      });

      const tools = [
        {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: { type: 'object', properties: { location: { type: 'string' } } },
        },
      ];

      await client.streamChat({
        messages: [{ role: 'user', content: 'Weather?' }],
        tools,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.tools).toEqual(tools);
    });

    it('accumulates local token metering across multiple requests and allows reset', async () => {
      const client = new OpenAiCompatibleClient(mockRemoteConfig, mockFetch);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: 'Turn 1' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: 'Turn 2' } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          }),
        });

      await client.chat({ messages: [{ role: 'user', content: 'Q1' }] });
      await client.chat({ messages: [{ role: 'user', content: 'Q2' }] });

      const metrics = client.getTokenUsageMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.promptTokens).toBe(30);
      expect(metrics.completionTokens).toBe(15);
      expect(metrics.totalTokens).toBe(45);

      client.resetTokenMetrics();
      expect(client.getTokenUsageMetrics().totalTokens).toBe(0);
    });
  });

  describe('Unified AI Router & Fallback Policy (WF-01 & WF-10)', () => {
    let mockOnDeviceProvider: AiExecutionProvider;
    let mockCloudClient: OpenAiCompatibleClient;

    beforeEach(() => {
      mockOnDeviceProvider = {
        providerType: 'on_device',
        isHealthy: jest.fn().mockResolvedValue(true),
        chat: jest.fn().mockResolvedValue({
          text: 'On-device offline response',
          executionMode: 'on_device',
          privacyNotice: {
            badge: PRIVACY_DISCLOSURE_COPY.onDeviceBadge,
            explanation: PRIVACY_DISCLOSURE_COPY.onDeviceExplanation,
          },
        }),
        streamChat: jest.fn().mockResolvedValue({
          text: 'On-device stream response',
          executionMode: 'on_device',
        }),
      };

      mockCloudClient = new OpenAiCompatibleClient(mockRemoteConfig, mockFetch);
    });

    it('strictly enforces on_device_only mode and throws error rather than routing off-device', async () => {
      (mockOnDeviceProvider.isHealthy as jest.Mock).mockResolvedValue(false);

      const router = new UnifiedAiRouter({
        mode: 'on_device_only',
        onDeviceProvider: mockOnDeviceProvider,
        cloudClient: mockCloudClient,
        userConsentedToCloud: false,
      });

      await expect(
        router.executeChat({ messages: [{ role: 'user', content: 'Strict offline' }] })
      ).rejects.toThrow(/On-device AI is currently unavailable and cloud fallback is disabled/);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('routes to on-device when auto_fallback is selected and local engine is healthy', async () => {
      const router = new UnifiedAiRouter({
        mode: 'auto_fallback',
        onDeviceProvider: mockOnDeviceProvider,
        cloudClient: mockCloudClient,
        userConsentedToCloud: true,
      });

      const response = await router.executeChat({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.executionMode).toBe('on_device');
      expect(response.text).toBe('On-device offline response');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to cloud with visual badge and fallback reason when on-device is unavailable', async () => {
      // Local engine fails health check (e.g. low memory or model missing)
      (mockOnDeviceProvider.isHealthy as jest.Mock).mockResolvedValue(false);
      (mockOnDeviceProvider.getUnavailableReason as any) = jest
        .fn()
        .mockReturnValue('TRIM_MEMORY_RUNNING_CRITICAL');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Cloud fallback reply' } }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        }),
      });

      const router = new UnifiedAiRouter({
        mode: 'auto_fallback',
        onDeviceProvider: mockOnDeviceProvider,
        cloudClient: mockCloudClient,
        userConsentedToCloud: true,
      });

      const response = await router.executeChat({
        messages: [{ role: 'user', content: 'Hello fallback' }],
      });

      expect(response.executionMode).toBe('cloud_fallback');
      expect(response.fallbackReason).toBe('TRIM_MEMORY_RUNNING_CRITICAL');
      expect(response.privacyNotice?.badge).toBe('Cloud Fallback');
      expect(response.privacyNotice?.explanation).toContain('encrypted in transit');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('requires explicit user privacy consent before initiating cloud fallback', async () => {
      (mockOnDeviceProvider.isHealthy as jest.Mock).mockResolvedValue(false);

      const router = new UnifiedAiRouter({
        mode: 'auto_fallback',
        onDeviceProvider: mockOnDeviceProvider,
        cloudClient: mockCloudClient,
        userConsentedToCloud: false, // User has NOT opted in yet
      });

      const res = await router.executeChat({
        messages: [{ role: 'user', content: 'Need fallback' }],
      });

      // Does not call network yet; returns pending consent requirement
      expect(res.requiresPrivacyConsent).toBe(true);
      expect(res.privacyNotice?.badge).toBe('Cloud Fallback');
      expect(res.privacyNotice?.modalText).toContain('zero-log cloud fallback');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

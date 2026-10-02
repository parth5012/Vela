import { classifyCloudError, CloudProviderError } from '../utils/providers/errors';
import { buildContextMessages } from '../utils/providers/context';
import { streamCloudResponse, getLanguageModel } from '../utils/providers';

describe('Cloud Provider Layer', () => {
  describe('classifyCloudError', () => {
    it('classifies 401 and invalid key errors as auth', () => {
      const err = classifyCloudError(new Error('Invalid API key provided'), 'gemini');
      expect(err.kind).toBe('auth');
      expect(err.provider).toBe('gemini');

      const err401 = classifyCloudError({ status: 401, message: 'Unauthorized' }, 'openai');
      expect(err401.kind).toBe('auth');
    });

    it('classifies quota and insufficient credit errors properly', () => {
      const err = classifyCloudError(new Error('You exceeded your current quota, please check your plan and billing details'), 'openai');
      expect(err.kind).toBe('quota');

      const errCredits = classifyCloudError({ status: 402, message: 'User has insufficient credits' }, 'openrouter');
      expect(errCredits.kind).toBe('quota');
    });

    it('classifies rate limit errors properly', () => {
      const err = classifyCloudError(new Error('Rate limit reached for requests per minute (429)'), 'anthropic');
      expect(err.kind).toBe('rate_limit');
    });

    it('classifies model not found errors properly', () => {
      const err = classifyCloudError(new Error('The model `gpt-5-turbo` does not exist'), 'openai');
      expect(err.kind).toBe('model_not_found');
    });

    it('classifies network failures properly', () => {
      const err = classifyCloudError(new Error('Network request failed'), 'groq');
      expect(err.kind).toBe('network');
    });

    it('redacts sensitive API keys and tokens from error messages', () => {
      const err = classifyCloudError(new Error('Failed request to https://api.openai.com?key=sk-1234567890abcdef'), 'openai');
      expect(err.message).not.toContain('sk-1234567890abcdef');
      expect(err.message).toContain('[REDACTED]');
    });

    it('handles circular references in errors gracefully without throwing', () => {
      const circularObj: any = { message: 'Network failed' };
      circularObj.self = circularObj;
      const err = classifyCloudError(circularObj, 'gemini');
      expect(err.kind).toBe('network');
    });
  });

  describe('buildContextMessages', () => {
    it('truncates messages exceeding token/message budget keeping the most recent', () => {
      const history = Array.from({ length: 40 }, (_, i) => ({
        id: `msg_${i}`,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i} content`,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      }));

      const context = buildContextMessages(history, { maxMessages: 20 });
      expect(context.length).toBe(20);
      expect(context[context.length - 1].content).toBe('Message 39 content');
      expect(context[0].content).toBe('Message 20 content');
    });

    it('filters out empty assistant messages', () => {
      const history = [
        { id: '1', role: 'user' as const, content: 'Hello', created_at: '' },
        { id: '2', role: 'assistant' as const, content: '', created_at: '' },
        { id: '3', role: 'assistant' as const, content: '   ', created_at: '' },
      ];
      const context = buildContextMessages(history);
      expect(context.length).toBe(1);
      expect(context[0].content).toBe('Hello');
    });

    it('strips leading assistant message so strict APIs (Anthropic/Gemini) receive user first', () => {
      const history = [
        { id: '1', role: 'assistant' as const, content: 'Welcome!', created_at: '' },
        { id: '2', role: 'user' as const, content: 'Hello', created_at: '' },
        { id: '3', role: 'assistant' as const, content: 'How can I help?', created_at: '' },
      ];
      const context = buildContextMessages(history);
      expect(context[0].role).toBe('user');
      expect(context.length).toBe(2);
    });
  });

  describe('getLanguageModel', () => {
    it('instantiates models for each supported provider slug', () => {
      expect(getLanguageModel('gemini', 'key', 'gemini-1.5-flash')).toBeDefined();
      expect(getLanguageModel('openai', 'key', 'gpt-4o-mini')).toBeDefined();
      expect(getLanguageModel('anthropic', 'key', 'claude-3-5-sonnet-20241022')).toBeDefined();
      expect(getLanguageModel('openrouter', 'key', 'anthropic/claude-3.5-sonnet')).toBeDefined();
      expect(getLanguageModel('groq', 'key', 'llama-3.3-70b-versatile')).toBeDefined();
      expect(getLanguageModel('custom', 'key', 'custom-model', 'https://api.my-llm.com/v1')).toBeDefined();
    });

    it('throws error on unsupported provider slug', () => {
      expect(() => getLanguageModel('unsupported' as any, 'key', 'model')).toThrow('Unsupported cloud provider');
    });
  });

  describe('streamCloudResponse', () => {
    it('throws CloudProviderError on missing API key', async () => {
      const onToken = jest.fn();
      const onDone = jest.fn();
      const onError = jest.fn();

      await streamCloudResponse({
        provider: 'gemini',
        apiKey: '',
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'hi' }],
        onToken,
        onDone,
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.any(CloudProviderError));
      expect(onError.mock.calls[0][0].kind).toBe('auth');
    });

    it('requires baseUrl for custom provider', async () => {
      const onToken = jest.fn();
      const onDone = jest.fn();
      const onError = jest.fn();

      await streamCloudResponse({
        provider: 'custom',
        apiKey: 'test-key',
        model: 'custom-model',
        baseUrl: '',
        messages: [{ role: 'user', content: 'hi' }],
        onToken,
        onDone,
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.any(CloudProviderError));
      expect(onError.mock.calls[0][0].message).toContain('Base URL is required');
    });

    it('streams tokens from provider textStream and calls onDone', async () => {
      const ai = require('ai');
      const spyStreamText = jest.spyOn(ai, 'streamText').mockReturnValueOnce({
        textStream: (async function* () {
          yield 'Hello';
          yield ' ';
          yield 'world!';
        })(),
      } as any);

      const tokens: string[] = [];
      const onDone = jest.fn();
      const onError = jest.fn();

      await streamCloudResponse({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
        onToken: (t) => tokens.push(t),
        onDone,
        onError,
      });

      expect(spyStreamText).toHaveBeenCalled();
      expect(tokens.join('')).toBe('Hello world!');
      expect(onDone).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();

      spyStreamText.mockRestore();
    });
  });
});

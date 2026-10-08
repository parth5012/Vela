import '@stardazed/streams-text-encoding';
import { streamText, LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ProviderSlug } from '../../store/useConfigStore';
import { classifyCloudError, CloudProviderError } from './errors';
import { getStreamingFetch } from './fetch';

export interface StreamCloudOptions {
  provider: ProviderSlug;
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  temperature?: number;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export function getLanguageModel(
  provider: ProviderSlug,
  apiKey: string,
  modelName: string,
  baseUrl?: string
): LanguageModel {
  const customFetch = getStreamingFetch();

  switch (provider) {
    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey,
        fetch: customFetch,
      });
      return google(modelName);
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey,
        fetch: customFetch,
      });
      return openai(modelName);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey,
        fetch: customFetch,
      });
      return anthropic(modelName);
    }
    case 'openrouter': {
      const openrouter = createOpenRouter({
        apiKey,
        fetch: customFetch,
      });
      return openrouter(modelName);
    }
    case 'groq': {
      const groq = createGroq({
        apiKey,
        fetch: customFetch,
      });
      return groq(modelName);
    }
    case 'custom': {
      let normalizedBaseUrl = (baseUrl || '').trim().replace(/\/+$/, '');
      if (normalizedBaseUrl && !/^https?:\/\//i.test(normalizedBaseUrl)) {
        normalizedBaseUrl = `https://${normalizedBaseUrl}`;
      }
      const custom = createOpenAICompatible({
        name: 'custom',
        apiKey,
        baseURL: normalizedBaseUrl,
        fetch: customFetch,
      });
      return custom(modelName);
    }
    default:
      throw new CloudProviderError('unknown', `Unsupported cloud provider: ${provider}`, provider);
  }
}

export async function streamCloudResponse(options: StreamCloudOptions): Promise<void> {
  const {
    provider,
    apiKey,
    model,
    baseUrl,
    systemPrompt,
    temperature,
    messages,
    onToken,
    onDone,
    onError,
    signal,
  } = options;

  if (!apiKey || !apiKey.trim()) {
    const err = new CloudProviderError(
      'auth',
      `API key is missing for ${provider}. Please enter a key in Settings.`,
      provider
    );
    onError(err);
    return;
  }

  if (provider === 'custom' && (!baseUrl || !baseUrl.trim())) {
    const err = new CloudProviderError(
      'unknown',
      'Base URL is required for custom OpenAI-compatible provider.',
      provider
    );
    onError(err);
    return;
  }

  try {
    const languageModel = getLanguageModel(provider, apiKey, model, baseUrl);

    const result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages: messages as any,
      temperature: typeof temperature === 'number' ? temperature : 0.7,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      if (signal?.aborted) {
        break;
      }
      onToken(chunk);
    }

    if (!signal?.aborted) {
      onDone();
    }
  } catch (error: any) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return;
    }
    const classified = classifyCloudError(error, provider);
    onError(classified);
  }
}

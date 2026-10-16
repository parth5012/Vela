import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProviderSlug } from '../../store/useConfigStore';
import { streamCloudResponse } from './index';

export const OPENROUTER_FREE_MODEL = 'gpt-oss-120b:free';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function trimBearerToken(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  return trimmed.replace(/^bearer\s+/i, '').trim();
}

export function isFreeModelId(modelId: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase().trim();
  if (lower.includes(':free') || lower.endsWith('/free') || lower.includes('-free')) {
    return true;
  }
  if (lower.startsWith('free-') || lower.includes('/free-')) {
    return true;
  }
  return false;
}

export function sortModelIds(models: string[]): string[] {
  return [...models].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

export interface FetchModelsResult {
  models: string[];
  error?: string;
}

export async function fetchCustomEndpointModels(
  baseUrl: string,
  apiKey: string
): Promise<FetchModelsResult> {
  const cleanKey = trimBearerToken(apiKey);
  let normalized = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    return { models: [], error: 'Base URL is required' };
  }
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  const endpoint = `${normalized}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = {};
    if (cleanKey) {
      headers['Authorization'] = `Bearer ${cleanKey}`;
    }
    const res = await fetch(endpoint, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      return { models: [], error: `Server returned HTTP ${res.status}` };
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      return { models: [], error: 'Malformed JSON response from /models' };
    }

    const rawList = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json)
      ? json
      : null;

    if (!rawList) {
      return { models: [], error: 'Malformed JSON response: missing models array' };
    }

    const ids: string[] = rawList
      .map((item: any) => (typeof item === 'string' ? item : item?.id || item?.name))
      .filter((id: any): id is string => typeof id === 'string' && Boolean(id.trim()));

    if (ids.length === 0) {
      return { models: [], error: 'Endpoint returned an empty model list' };
    }

    return { models: sortModelIds(ids) };
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      return { models: [], error: 'Network timeout connecting to /models' };
    }
    return { models: [], error: 'Network error connecting to /models' };
  } finally {
    clearTimeout(timeout);
  }
}

export const CURATED_MODELS: Record<ProviderSlug, string[]> = {
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'o1-mini', 'o3-mini'],
  anthropic: [
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  openrouter: [
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o-mini',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-r1',
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ],
  custom: [],
};

export function getCuratedModels(provider: ProviderSlug): string[] {
  return CURATED_MODELS[provider] || [];
}

const CACHE_PREFIX = 'cloud_models_cache_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchProviderModels(
  provider: ProviderSlug,
  apiKey: string,
  baseUrl?: string,
  forceRefresh = false
): Promise<string[]> {
  const curated = getCuratedModels(provider);

  if (!apiKey || !apiKey.trim()) {
    return curated;
  }

  const cacheKey = `${CACHE_PREFIX}${provider}_${baseUrl || 'default'}`;

  if (!forceRefresh) {
    try {
      const cachedStr = await AsyncStorage.getItem(cacheKey);
      if (cachedStr) {
        const parsed = JSON.parse(cachedStr);
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS && Array.isArray(parsed.models)) {
          return parsed.models;
        }
      }
    } catch {
      // ignore cache read failure
    }
  }

  let fetchedModels: string[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    if (provider === 'gemini') {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        {
          headers: { 'x-goog-api-key': apiKey.trim() },
          signal: controller.signal,
        }
      );
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.models)) {
          fetchedModels = json.models
            .map((m: any) => m.name?.replace(/^models\//, ''))
            .filter((name: string) => name && name.includes('gemini'));
        }
      }
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data)) {
          fetchedModels = json.data
            .map((m: any) => m.id)
            .filter((id: string) => id && (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3')));
        }
      }
    } else if (provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data)) {
          fetchedModels = json.data.map((m: any) => m.id).filter(Boolean);
        }
      }
    } else if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data)) {
          fetchedModels = json.data.map((m: any) => m.id).filter(Boolean);
        }
      }
    } else if (provider === 'custom' && baseUrl) {
      const customRes = await fetchCustomEndpointModels(baseUrl, apiKey);
      if (customRes.models.length > 0) {
        fetchedModels = customRes.models;
      }
    }
  } catch (e) {
    console.warn(`[fetchProviderModels] Failed to fetch models for ${provider}:`, e);
  } finally {
    clearTimeout(timeout);
  }

  // Only cache when models were actually retrieved from the network
  if (fetchedModels.length > 0) {
    const combined = sortModelIds(Array.from(new Set([...curated, ...fetchedModels])).filter(Boolean));
    try {
      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({ timestamp: Date.now(), models: combined })
      );
    } catch {
      // ignore cache write failure
    }
    return combined;
  }

  return sortModelIds(curated);
}

export async function testProviderConnection(
  provider: ProviderSlug,
  apiKey: string,
  model: string,
  baseUrl?: string
): Promise<{ ok: boolean; message: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, message: 'API key is required.' };
  }

  if (provider === 'custom' && (!baseUrl || !baseUrl.trim())) {
    return { ok: false, message: 'Base URL is required for custom provider.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  let receivedAnyToken = false;
  let testError: string | null = null;

  try {
    await streamCloudResponse({
      provider,
      apiKey: apiKey.trim(),
      model: model || getCuratedModels(provider)[0] || 'default',
      baseUrl: baseUrl?.trim(),
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
      onToken: () => {
        receivedAnyToken = true;
        controller.abort(); // received token, connection verified!
      },
      onDone: () => {},
      onError: (err) => {
        testError = err.message;
      },
    });
    clearTimeout(timeoutId);

    if (receivedAnyToken) {
      return { ok: true, message: 'Connection successful!' };
    }
    if (controller.signal.aborted) {
      return { ok: false, message: 'Connection timed out after 12 seconds.' };
    }
    if (testError) {
      return { ok: false, message: testError };
    }
    return { ok: false, message: 'Connection test failed: no tokens received.' };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (receivedAnyToken) {
      return { ok: true, message: 'Connection successful!' };
    }
    if (controller.signal.aborted) {
      return { ok: false, message: 'Connection timed out after 12 seconds.' };
    }
    return { ok: false, message: err?.message || 'Connection test failed.' };
  }
}

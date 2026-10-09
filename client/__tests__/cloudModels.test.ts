import {
  fetchProviderModels,
  fetchCustomEndpointModels,
  getCuratedModels,
  testProviderConnection,
  trimBearerToken,
  isFreeModelId,
  sortModelIds,
  OPENROUTER_FREE_MODEL,
} from '../utils/providers/models';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Cloud Provider Models & Connection', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('trimBearerToken', () => {
    it('handles keys with and without Bearer prefix, whitespace, and mixed case', () => {
      expect(trimBearerToken('sk-12345')).toBe('sk-12345');
      expect(trimBearerToken('  sk-12345  ')).toBe('sk-12345');
      expect(trimBearerToken('Bearer sk-12345')).toBe('sk-12345');
      expect(trimBearerToken('bearer sk-12345')).toBe('sk-12345');
      expect(trimBearerToken('BEARER sk-12345')).toBe('sk-12345');
      expect(trimBearerToken('  Bearer   sk-12345  ')).toBe('sk-12345');
      expect(trimBearerToken('')).toBe('');
      expect(trimBearerToken(undefined as any)).toBe('');
    });
  });

  describe('isFreeModelId', () => {
    it('identifies free models across OpenRouter, NIM, and other conventions', () => {
      expect(isFreeModelId('gpt-oss-120b:free')).toBe(true);
      expect(isFreeModelId('meta-llama/llama-3.3-70b-instruct:free')).toBe(true);
      expect(isFreeModelId('nvidia/llama-3.1-nemotron-70b-instruct/free')).toBe(true);
      expect(isFreeModelId('free-tier/mistral-7b')).toBe(true);
      expect(isFreeModelId('deepseek-r1-free')).toBe(true);
      expect(isFreeModelId('nvidia/free-nemotron')).toBe(true);

      expect(isFreeModelId('gpt-4o')).toBe(false);
      expect(isFreeModelId('claude-3-5-sonnet-20241022')).toBe(false);
      expect(isFreeModelId('meta-llama/llama-3.3-70b-instruct')).toBe(false);
      expect(isFreeModelId('')).toBe(false);
      expect(isFreeModelId(null as any)).toBe(false);
    });
  });

  describe('sortModelIds', () => {
    it('sorts model IDs deterministically using natural case-insensitive comparison', () => {
      const unsorted = ['gpt-4o', 'gpt-3.5-turbo', 'GPT-4o-mini', 'claude-3-sonnet', 'claude-3.5-sonnet', 'claude-3-opus'];
      const sorted = sortModelIds(unsorted);
      expect(sorted).toEqual([
        'claude-3-opus',
        'claude-3-sonnet',
        'claude-3.5-sonnet',
        'gpt-3.5-turbo',
        'gpt-4o',
        'GPT-4o-mini',
      ]);
    });
  });

  describe('fetchCustomEndpointModels', () => {
    const mockSecret = 'super-secret-nim-key-xyz';

    it('fetches, parses, and sorts models successfully', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'meta/llama-3.1-8b-instruct' },
            { id: 'meta/llama-3.1-70b-instruct:free' },
            { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
          ],
        }),
      } as any);

      const res = await fetchCustomEndpointModels('https://integrate.api.nvidia.com/v1', mockSecret);
      expect(res.error).toBeUndefined();
      expect(res.models).toEqual([
        'meta/llama-3.1-8b-instruct',
        'meta/llama-3.1-70b-instruct:free',
        'nvidia/llama-3.1-nemotron-70b-instruct',
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://integrate.api.nvidia.com/v1/models',
        expect.objectContaining({
          headers: { Authorization: `Bearer ${mockSecret}` },
        })
      );
      mockFetch.mockRestore();
    });

    it('handles non-200 responses with an honest error without leaking the key', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as any);

      const res = await fetchCustomEndpointModels('https://nim.example.com', mockSecret);
      expect(res.models).toEqual([]);
      expect(res.error).toBe('Server returned HTTP 403');
      expect(res.error).not.toContain(mockSecret);
      mockFetch.mockRestore();
    });

    it('handles malformed JSON response with an honest error without leaking the key', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Unexpected token < in JSON at position 0');
        },
      } as any);

      const res = await fetchCustomEndpointModels('https://nim.example.com', mockSecret);
      expect(res.models).toEqual([]);
      expect(res.error).toBe('Malformed JSON response from /models');
      expect(res.error).not.toContain(mockSecret);
      mockFetch.mockRestore();
    });

    it('handles empty model list with an honest error', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as any);

      const res = await fetchCustomEndpointModels('https://nim.example.com', mockSecret);
      expect(res.models).toEqual([]);
      expect(res.error).toBe('Endpoint returned an empty model list');
      mockFetch.mockRestore();
    });

    it('handles network failure with an honest error without leaking the key', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error(`Failed to fetch for ${mockSecret}`)
      );

      const res = await fetchCustomEndpointModels('https://nim.example.com', mockSecret);
      expect(res.models).toEqual([]);
      expect(res.error).toBe('Network error connecting to /models');
      expect(res.error).not.toContain(mockSecret);
      mockFetch.mockRestore();
    });
  });

  it('returns curated fallback models when no API key or network fails', async () => {
    const models = await fetchProviderModels('openai', '');
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain('gpt-4o-mini');
  });

  it('fetches and caches models from OpenAI-compatible endpoint', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-4o-custom' }, { id: 'gpt-4o-mini-custom' }],
      }),
    } as any);

    const models = await fetchProviderModels('openai', 'sk-valid');
    expect(mockFetch).toHaveBeenCalled();
    expect(models).toContain('gpt-4o-custom');

    // Test cache: next call with same key should not fetch again immediately
    const cached = await fetchProviderModels('openai', 'sk-valid');
    expect(cached).toContain('gpt-4o-custom');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockRestore();
  });

  it('fetches gemini models using x-goog-api-key header', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-2.0-flash' }],
      }),
    } as any);

    const models = await fetchProviderModels('gemini', 'gemini-secret-key');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({
        headers: { 'x-goog-api-key': 'gemini-secret-key' },
      })
    );
    expect(models).toContain('gemini-2.0-flash');
    mockFetch.mockRestore();
  });

  describe('testProviderConnection', () => {
    it('returns error when API key is missing', async () => {
      const res = await testProviderConnection('gemini', '', 'gemini-1.5-flash');
      expect(res.ok).toBe(false);
      expect(res.message).toContain('API key is required');
    });

    it('returns error when baseUrl is missing for custom provider', async () => {
      const res = await testProviderConnection('custom', 'key', 'model', '');
      expect(res.ok).toBe(false);
      expect(res.message).toContain('Base URL is required');
    });

    it('returns success when tokens are received', async () => {
      const providerModule = require('../utils/providers');
      const spyStream = jest.spyOn(providerModule, 'streamCloudResponse').mockImplementation(async (opts: any) => {
        opts.onToken('test-chunk');
      });

      const res = await testProviderConnection('openai', 'sk-test', 'gpt-4o-mini');
      expect(res.ok).toBe(true);
      expect(res.message).toContain('Connection successful');

      spyStream.mockRestore();
    });
  });
});

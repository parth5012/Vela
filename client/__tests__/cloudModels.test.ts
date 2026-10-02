import { fetchProviderModels, getCuratedModels, testProviderConnection } from '../utils/providers/models';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Cloud Provider Models & Connection', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
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

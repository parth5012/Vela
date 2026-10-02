import { Platform } from 'react-native';

export function getStreamingFetch(): typeof fetch {
  if (Platform.OS !== 'web' && process.env.NODE_ENV !== 'test') {
    try {
      const rnFetchApi = require('react-native-fetch-api');
      const fetchImpl = rnFetchApi.fetch || rnFetchApi.default || rnFetchApi;
      return (input: any, init?: any) => {
        return fetchImpl(input, {
          ...init,
          reactNative: { textStreaming: true },
        });
      };
    } catch {
      return fetch;
    }
  }
  return fetch;
}

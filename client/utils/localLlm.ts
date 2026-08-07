import { NativeModules } from 'react-native';

export let isLocalModelLoaded = false;
let useFallback = false;

// Determine if native bridge is available.
const GemmaNative = NativeModules?.GemmaReactNativeModule;

function mockResponseTemplate(prompt: string): string {
  const lowercasePrompt = prompt.toLowerCase();
  if (lowercasePrompt.includes('weather')) {
    return "The weather is currently sunny and 72 degrees. The local assistant is working offline.";
  }
  if (lowercasePrompt.includes('drizzle') || lowercasePrompt.includes('sqlite')) {
    return "Local database initialized with Drizzle and SQLite. Synced messages queue structure is active.";
  }
  return "This is a response from Gemma running locally. MediaPipe LLM Inference API is functioning offline.";
}

/**
 * Initializes Gemma/MediaPipe inference engine.
 * Gracefully falls back to mock initialization in test/preview/non-native environments.
 */
export async function initializeLocalModel(): Promise<void> {
  if (isLocalModelLoaded) {
    return;
  }

  useFallback = false;

  if (GemmaNative && typeof GemmaNative.initializeLocalModel === 'function') {
    try {
      await GemmaNative.initializeLocalModel();
    } catch (error) {
      console.warn('Native Gemma initialization failed, using mock fallback:', error);
      useFallback = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } else {
    useFallback = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  isLocalModelLoaded = true;
}

/**
 * Unloads local LLM model memory.
 */
export async function unloadLocalModel(): Promise<void> {
  if (!isLocalModelLoaded) {
    return;
  }

  if (!useFallback && GemmaNative && typeof GemmaNative.unloadLocalModel === 'function') {
    try {
      await GemmaNative.unloadLocalModel();
    } catch (error) {
      console.warn('Native Gemma unload failed:', error);
    }
  }

  isLocalModelLoaded = false;
  useFallback = false;
}

/**
 * Streams response from local LLM model.
 * Falls back to mock local generator if native engine is not available.
 * Supports both AsyncGenerator and callback-based token emission interface.
 */
export async function* streamLocalLlmResponse(
  prompt: string,
  onToken?: (token: string) => void
): AsyncGenerator<string, void, unknown> {
  if (!isLocalModelLoaded) {
    throw new Error('Local model not loaded. Call initializeLocalModel() first.');
  }

  // Attempt using Native module streaming function if not in fallback mode
  if (!useFallback && GemmaNative && typeof GemmaNative.streamLlmResponse === 'function') {
    try {
      const tokens: string[] = [];
      const nativePromise = new Promise<void>((resolve, reject) => {
        GemmaNative.streamLlmResponse(
          prompt,
          (token: string) => {
            tokens.push(token);
            if (onToken) {
              onToken(token);
            }
          },
          () => resolve(),
          (error: string) => reject(new Error(error))
        );
      });

      await nativePromise;

      for (const token of tokens) {
        yield token;
      }
      return;
    } catch (error) {
      console.warn('Native Gemma streaming failed, using mock fallback:', error);
    }
  }

  // Mock generator fallback: simulated text generation delays
  const responseText = "This is a simulated local LLM response. The Gemma model is running in fallback mock mode.";
  const words = responseText.split(' ');

  for (let i = 0; i < words.length; i++) {
    const token = words[i] + (i === words.length - 1 ? '' : ' ');
    // Realistic delay simulating local inference token emission
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (onToken) {
      onToken(token);
    }
    yield token;
  }
}

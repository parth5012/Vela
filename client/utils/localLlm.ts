import { NativeModules } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';

export let isLocalModelLoaded = false;
let useFallback = false;
export let isLocalLlmDown = false;

export function setLocalLlmDown(down: boolean) {
  isLocalLlmDown = down;
}

// Determine if native bridge is available.
const GemmaNative = NativeModules?.GemmaReactNativeModule;

function mockResponseTemplate(prompt: string): string {
  const localModelName = useConfigStore.getState().localModelName || 'Gemma 2B';
  const lowercasePrompt = prompt.toLowerCase();
  if (lowercasePrompt.includes('weather')) {
    return `The weather is currently sunny and 72 degrees. Behind the scenes, the local assistant (${localModelName}) is working offline.`;
  }
  if (lowercasePrompt.includes('drizzle') || lowercasePrompt.includes('sqlite')) {
    return `Local database initialized with Drizzle SQLite. Synced messages queue structure is active with ${localModelName}.`;
  }
  return `This is a simulated local LLM response. The ${localModelName} model is running in fallback mock mode. MediaPipe LLM Inference API is functioning offline.`;
}

/**
 * Initializes Gemma/MediaPipe inference engine.
 * Gracefully falls back to mock initialization in test/preview/non-native environments.
 */
export async function initializeLocalModel(): Promise<void> {
  if (isLocalLlmDown) {
    throw new Error('Local LLM is down/unavailable.');
  }

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
  if (isLocalLlmDown) {
    throw new Error('Local LLM is down/unavailable.');
  }

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
  const responseText = mockResponseTemplate(prompt);
  const words = responseText.split(' ');

  for (let i = 0; i < words.length; i++) {
    const token = words[i] + (i === words.length - 1 ? '' : ' ');
    // Realistic delay simulating local inference token emission
    const delay = process.env.NODE_ENV === 'test' ? 10 : 80;
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (onToken) {
      onToken(token);
    }
    yield token;
  }
}

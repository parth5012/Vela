import { NativeModules, NativeEventEmitter } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Event name emitted by GemmaReactNativeModule for streamed generation. */
const GEMMA_STREAM_EVENT = 'GemmaLlmStream';

/** Upper bound on a single generation before we give up and fall back. */
const NATIVE_STREAM_TIMEOUT_MS = 120000;

type GemmaStreamEvent =
  | { type: 'token'; token?: string }
  | { type: 'done' }
  | { type: 'error'; message?: string };

export let isLocalModelLoaded = false;
let useFallback = false;
export let isLocalLlmDown = false;

/**
 * Why the engine fell back to mock output, if it did. Surfaced in the UI so a
 * broken model file never masquerades as a working local LLM.
 */
export let localLlmFallbackReason: string | null = null;

export function getLocalLlmFallbackReason(): string | null {
  return useFallback ? localLlmFallbackReason : null;
}

export function isUsingMockFallback(): boolean {
  return useFallback;
}

export function setLocalLlmDown(down: boolean) {
  isLocalLlmDown = down;
}

/**
 * Single source of truth for the per-model "is downloaded" AsyncStorage key.
 * Both the chat screen and settings screen must use this so a model downloaded
 * in one place is visible in the other.
 */
export const LOCAL_MODEL_STORAGE_PREFIX = 'local_model_downloaded_';

export function localModelStorageKey(modelName: string): string {
  return `${LOCAL_MODEL_STORAGE_PREFIX}${modelName}`;
}

export interface LocalModelSpec {
  name: string;
  size: string;
  description: string;
  downloadUrl: string;
  filename: string;
}

/**
 * Single source of truth for the downloadable local models.
 *
 * IMPORTANT: MediaPipe `tasks-genai` CANNOT load GGUF files — GGUF is the
 * llama.cpp format. LlmInference requires the LiteRT `.task` bundle format.
 * These URLs point at the ungated `litert-community` HuggingFace repos, which
 * serve `.task` files without an auth token. If these are swapped back to GGUF
 * URLs, `createFromOptions` throws and the app silently serves mock responses.
 */
export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    name: 'Qwen2.5 0.5B',
    size: '~0.52 GB',
    description: 'Fastest, lowest memory use',
    downloadUrl:
      'https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task',
    filename: 'Qwen2.5-0.5B-Instruct_q8_ekv1280.task',
  },
  {
    name: 'TinyLlama 1.1B',
    size: '~1.1 GB',
    description: 'Balanced quality and speed',
    downloadUrl:
      'https://huggingface.co/litert-community/TinyLlama-1.1B-Chat-v1.0/resolve/main/TinyLlama-1.1B-Chat-v1.0_multi-prefill-seq_q8_ekv1280.task',
    filename: 'TinyLlama-1.1B-Chat-v1.0_q8_ekv1280.task',
  },
  {
    name: 'SmolLM 135M',
    size: '~0.16 GB',
    description: 'Smallest, for low-end devices',
    downloadUrl:
      'https://huggingface.co/litert-community/SmolLM-135M-Instruct/resolve/main/SmolLM-135M-Instruct_multi-prefill-seq_q8_ekv1280.task',
    filename: 'SmolLM-135M-Instruct_q8_ekv1280.task',
  },
];

// Determine if native bridge is available.
const GemmaNative = NativeModules?.GemmaReactNativeModule;

function mockResponseTemplate(prompt: string): string {
  const localModelName = useConfigStore.getState().localModelName || 'local model';
  if (localLlmFallbackReason) {
    return `[Mock mode — the local model is NOT running] ${localLlmFallbackReason}`;
  }
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
  localLlmFallbackReason = null;

  if (GemmaNative && typeof GemmaNative.initializeLocalModel === 'function') {
    try {
      const localModelName = useConfigStore.getState().localModelName;
      const key = localModelStorageKey(localModelName) + '_path';
      const modelPath = await AsyncStorage.getItem(key);
      if (!modelPath) {
        throw new Error(
          `No downloaded model found for "${localModelName}". Download it in Settings first.`
        );
      }

      // MediaPipe only accepts LiteRT `.task` bundles. A GGUF file here means
      // the model list is stale — fail loudly instead of pretending to work.
      if (!modelPath.endsWith('.task')) {
        throw new Error(
          `Model "${localModelName}" is not a LiteRT .task bundle (got ${modelPath
            .split('/')
            .pop()}). MediaPipe cannot run GGUF files. Delete and re-download it in Settings.`
        );
      }

      const cleanPath = modelPath.startsWith('file://') ? modelPath.slice(7) : modelPath;
      await GemmaNative.initializeLocalModel(cleanPath);
    } catch (error: any) {
      const reason = error?.message || String(error);
      console.warn('Native local LLM initialization failed, using mock fallback:', reason);
      useFallback = true;
      localLlmFallbackReason = reason;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } else {
    useFallback = true;
    localLlmFallbackReason =
      'Native local-inference module unavailable in this build (Expo Go or web). Use a development build.';
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
  localLlmFallbackReason = null;
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
    let subscription: { remove: () => void } | null = null;
    try {
      // Tokens arrive as events, not callbacks: an RN bridge Callback can only
      // fire once, and a second invocation aborts the process on the New
      // Architecture ("Callback arg cannot be called more than once").
      const emitter = new NativeEventEmitter(GemmaNative);

      const queue: string[] = [];
      let finished = false;
      let failure: Error | null = null;
      let wake: (() => void) | null = null;

      const notify = () => {
        const w = wake;
        wake = null;
        w?.();
      };

      subscription = emitter.addListener(GEMMA_STREAM_EVENT, (event: GemmaStreamEvent) => {
        if (event?.type === 'token') {
          if (event.token) {
            queue.push(event.token);
          }
        } else if (event?.type === 'done') {
          finished = true;
        } else if (event?.type === 'error') {
          failure = new Error(event.message || 'Native generation error');
          finished = true;
        }
        notify();
      });

      // Rejects if the engine refuses to start; resolution only means the
      // prompt was accepted, so completion is still signalled by events.
      await GemmaNative.streamLlmResponse(prompt);

      const deadline = Date.now() + NATIVE_STREAM_TIMEOUT_MS;

      while (true) {
        while (queue.length > 0) {
          const token = queue.shift() as string;
          onToken?.(token);
          yield token;
        }

        if (failure) throw failure;
        if (finished) break;

        if (Date.now() > deadline) {
          throw new Error(
            `Native streaming timed out after ${NATIVE_STREAM_TIMEOUT_MS / 1000}s`
          );
        }

        // Wait for the next event rather than polling hot.
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(notify, 250);
        });
      }

      return;
    } catch (error: any) {
      const reason = error?.message || String(error);
      console.warn('Native local LLM streaming failed, using mock fallback:', reason);
      useFallback = true;
      localLlmFallbackReason = reason;
    } finally {
      subscription?.remove();
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

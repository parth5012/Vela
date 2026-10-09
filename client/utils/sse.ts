import { Platform } from 'react-native';
import { stripReasoning, EMPTY_RESPONSE_ERROR_HINT } from './reasoning';
import { withRetry, isTransientError } from './retry';

const normalizeUrl = (rawUrl: string): string => {
  let formattedUrl = (rawUrl || '').trim();
  if (!formattedUrl) return '';
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }
  return formattedUrl.replace(/\/+$/, '');
};

// Default timeout: 90 seconds (handles Render cold start)
const DEFAULT_TIMEOUT_MS = 90000;

async function executeStreamRequest(
  url: string,
  apiKey: string,
  threadId: string,
  message: string,
  onChunk: (chunk: string) => void,
  onDone: (newTitle?: string) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
  agent?: string,
  onAuthRequired?: (provider: string) => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<void> {
  // Create a timeout controller to abort the request if it takes too long
  let resetTimeout: () => void = () => {};
  const timeoutController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
    timeoutController.abort(new Error(`Request timed out after ${timeoutMs / 1000}s. Server may be waking up.`));
  }, timeoutMs);

  // Combine external signal with timeout controller
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const formattedUrl = normalizeUrl(url);
    if (!formattedUrl) {
      throw new Error('API URL is not configured.');
    }

    // Default agent to 'personal assistant' if not provided
    const requestAgent = agent || 'personal assistant';

    let sseFetch: typeof fetch;
    try {
      if (Platform.OS !== 'web' && process.env.NODE_ENV !== 'test') {
        const rnFetchApi = require('react-native-fetch-api');
        sseFetch = rnFetchApi.fetch || rnFetchApi.default || rnFetchApi;
      } else {
        sseFetch = fetch;
      }
    } catch (libError) {
      console.warn('[streamAgentResponse] react-native-fetch-api not available, falling back to native fetch');
      sseFetch = fetch;
    }

    console.log('[streamAgentResponse] Sending request to:', `${formattedUrl}/chat/message`, 'agent:', requestAgent);

    const requestBody = JSON.stringify({
      thread_id: threadId,
      message,
      agent: requestAgent,
    });
    resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutController.abort(new Error(`Response idle for ${timeoutMs / 1000}s. Server may be stuck.`));
      }, timeoutMs);
    };

    const fetchOptions: any = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: requestBody,
      signal: combinedSignal,
    };

    // Only add reactNative option for react-native-fetch-api
    if (Platform.OS !== 'web' && process.env.NODE_ENV !== 'test') {
      fetchOptions.reactNative = { textStreaming: true };
    }

    const response = await sseFetch(`${formattedUrl}/chat/message`, fetchOptions);

    console.log('[streamAgentResponse] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error body');
      console.error('[streamAgentResponse] Server error:', response.status, errorText);
      throw new Error(`Server returned HTTP ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("Response body is not readable");
    }

    let buffer = '';
    let chunkCount = 0;
    let accumulatedContent = '';
    let emittedLength = 0;

    const handleDelta = (delta: string) => {
      accumulatedContent += delta;
      const stripped = stripReasoning(accumulatedContent, true);
      if (stripped.length > emittedLength) {
        const newSegment = stripped.slice(emittedLength);
        emittedLength = stripped.length;
        onChunk(newSegment);
      }
    };

    const handleStreamEnd = (threadTitle?: string) => {
      const finalContent = stripReasoning(accumulatedContent, false);
      if (!finalContent.trim()) {
        throw new Error(EMPTY_RESPONSE_ERROR_HINT);
      }
      if (finalContent.length > emittedLength) {
        const remaining = finalContent.slice(emittedLength);
        emittedLength = finalContent.length;
        onChunk(remaining);
      }
      onDone(threadTitle);
    };

    resetTimeout();
    while (true) {
      const { value, done } = await reader.read();
      resetTimeout();
      if (done) {
        // Clear timeout on successful completion
        clearTimeout(timeoutId);
        const cleaned = buffer.trim();
        if (cleaned.startsWith('data: ')) {
          const rawData = cleaned.slice(6);
          try {
            const parsed = JSON.parse(rawData);
            if (parsed.type === 'content') {
              handleDelta(parsed.delta);
            } else if (parsed.type === 'done') {
              handleStreamEnd(parsed.thread_title);
              console.log('[streamAgentResponse] Stream complete, total chunks:', chunkCount);
              return;
            } else if (parsed.type === 'error') {
              onError(new Error(parsed.message || 'Unknown server error'));
              return;
            } else if (parsed.type === 'auth_required') {
              if (onAuthRequired) {
                onAuthRequired(parsed.provider || 'google');
              }
            }
          } catch {
            // Ignore malformed JSON
          }
        }
        handleStreamEnd();
        console.log('[streamAgentResponse] Stream complete, total chunks:', chunkCount);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      buffer = lines.pop() || '';

      for (const line of lines) {
        const cleaned = line.trim();
        if (cleaned.startsWith('data: ')) {
          const rawData = cleaned.slice(6);
          try {
            const parsed = JSON.parse(rawData);
            chunkCount++;
            if (parsed.type === 'content') {
              handleDelta(parsed.delta);
            } else if (parsed.type === 'done') {
              handleStreamEnd(parsed.thread_title);
              return;
            } else if (parsed.type === 'error') {
              onError(new Error(parsed.message || 'Unknown server error'));
              return;
            } else if (parsed.type === 'auth_required') {
              if (onAuthRequired) {
                onAuthRequired(parsed.provider || 'google');
              }
            }
          } catch {
            // Ignore malformed JSON chunks
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface StreamAgentResponseOptions {
  delays?: number[];
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export async function streamAgentResponse(
  url: string,
  apiKey: string,
  threadId: string,
  message: string,
  onChunk: (chunk: string) => void,
  onDone: (newTitle?: string) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
  agent?: string,
  onAuthRequired?: (provider: string) => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  retryOptions?: StreamAgentResponseOptions
): Promise<void> {
  try {
    await withRetry(
      () =>
        executeStreamRequest(
          url,
          apiKey,
          threadId,
          message,
          onChunk,
          onDone,
          onError,
          signal,
          agent,
          onAuthRequired,
          timeoutMs
        ),
      {
        signal,
        delays: retryOptions?.delays,
        maxRetries: retryOptions?.maxRetries,
        sleepFn: retryOptions?.sleepFn,
        isRetryable: (err: unknown) => {
          const message = err instanceof Error ? err.message : (err as { message?: string })?.message;
          if (message === EMPTY_RESPONSE_ERROR_HINT) return false;
          return isTransientError(err);
        },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[streamAgentResponse] Error:', message);
    if (!signal?.aborted) {
      onError(error instanceof Error ? error : new Error(message));
    }
  }
}

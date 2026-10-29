import { Platform } from 'react-native';
import { stripReasoning, EMPTY_RESPONSE_ERROR_HINT } from './reasoning';
import { withRetry, isTransientError } from './retry';
import { streamController } from './streamController';
import { counter, record, timer } from './metrics';

const normalizeUrl = (rawUrl: string): string => {
  let formattedUrl = (rawUrl || '').trim();
  if (!formattedUrl) return '';
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }
  return formattedUrl.replace(/\/+$/, '');
};

/** Monotonic clock for idle-gap measurement; mirrors utils/metrics. */
const transportNowMs = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

/**
 * Buckets a failed stream attempt into a coarse error type used in the
 * `sse.failures.<type>` counter names.
 */
function classifySseFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('Server returned HTTP')) return 'http_error';
  if (message.includes('timed out') || message.includes('Response idle')) return 'timeout';
  if (message.includes('Empty response')) return 'empty_response';
  if (message.toLowerCase().includes('abort')) return 'abort';
  return 'network_error';
}

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
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  streamGeneration?: number
): Promise<void> {
  // Create a timeout controller to abort the request if it takes too long
  let resetTimeout: () => void = () => {};
  const timeoutController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
    timeoutController.abort(new Error(`Request timed out after ${timeoutMs / 1000}s. Server may be waking up.`));
  }, timeoutMs);

  // Transport metrics (WF-501): one sample set per stream attempt.
  counter('sse.attempts').inc();
  let chunkCount = 0;
  let bytesReceived = 0;
  let maxIdleGapMs = 0;
  let lastReadEnd: number | null = null;
  let succeeded = false;
  let failureType: string | null = null;
  const ttfc = timer('sse.ttfc');
  ttfc.start();

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

    const effectiveGeneration = streamGeneration !== undefined
      ? streamGeneration
      : (streamController.getGeneration ? streamController.getGeneration(threadId) : undefined);

    const bodyObj: Record<string, any> = {
      thread_id: threadId,
      message,
      agent: requestAgent,
    };
    if (effectiveGeneration !== undefined && effectiveGeneration > 0) {
      bodyObj.stream_generation = effectiveGeneration;
    }

    const requestBody = JSON.stringify(bodyObj);
    record('sse.request_bytes', typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(requestBody).length : requestBody.length);
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
      const readEnd = transportNowMs();
      if (value && value.byteLength > 0) {
        bytesReceived += value.byteLength;
        // TTFC: first transport chunk for the attempt; stop() is a no-op once recorded.
        ttfc.stop();
      }
      // Idle gap: time between consecutive read() completions (first read excluded).
      if (lastReadEnd !== null) {
        maxIdleGapMs = Math.max(maxIdleGapMs, readEnd - lastReadEnd);
      }
      lastReadEnd = readEnd;
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
              succeeded = true;
              console.log('[streamAgentResponse] Stream complete, total chunks:', chunkCount);
              return;
            } else if (parsed.type === 'thread_stopped') {
              succeeded = true;
              console.log('[streamAgentResponse] Stream stopped by server');
              return;
            } else if (parsed.type === 'error') {
              failureType = 'server_error';
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
        succeeded = true;
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
              succeeded = true;
              return;
            } else if (parsed.type === 'thread_stopped') {
              succeeded = true;
              console.log('[streamAgentResponse] Stream stopped by server');
              return;
            } else if (parsed.type === 'error') {
              failureType = 'server_error';
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
  } catch (err: unknown) {
    failureType = classifySseFailure(err);
    throw err;
  } finally {
    clearTimeout(timeoutId);
    // Per-attempt transport metrics (WF-501); recorded for success and error paths.
    // TTFC only counts as time-to-FIRST-CHUNK when at least one byte arrived.
    if (bytesReceived > 0) {
      ttfc.stop();
    }
    record('sse.chunk_count', chunkCount);
    record('sse.bytes_received', bytesReceived);
    record('sse.idle_gap_max', maxIdleGapMs);
    if (succeeded) {
      counter('sse.successes').inc();
    } else {
      counter(`sse.failures.${failureType ?? 'other'}`).inc();
    }
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
  retryOptions?: StreamAgentResponseOptions,
  streamGeneration?: number
): Promise<void> {
  let emittedAny = false;
  const trackedOnChunk = (chunk: string) => {
    emittedAny = true;
    onChunk(chunk);
  };

  const turnTimer = timer('sse.turn_duration');
  turnTimer.start();

  try {
    await withRetry(
      () =>
        executeStreamRequest(
          url,
          apiKey,
          threadId,
          message,
          trackedOnChunk,
          onDone,
          onError,
          signal,
          agent,
          onAuthRequired,
          timeoutMs,
          streamGeneration
        ),
      {
        signal,
        delays: retryOptions?.delays,
        maxRetries: retryOptions?.maxRetries,
        sleepFn: retryOptions?.sleepFn,
        isRetryable: (err: unknown) => {
          if (emittedAny) return false;
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
  } finally {
    turnTimer.stop();
  }
}

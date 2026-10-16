/**
 * Module: client/utils/retry
 * Intent: Declarative retry with exponential backoff for transient network and 5xx failures.
 * Responsibilities:
 *  - Pure, stateless retry helper with configurable delays.
 *  - Distinguishes transient (network, 5xx, aborted streams) from fatal 4xx errors.
 *  - AbortSignal aware to halt retry attempts when cancelled.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  delays?: number[];
  signal?: AbortSignal;
  isRetryable?: (error: unknown) => boolean;
  sleepFn?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY_DELAYS = [250, 500, 1000, 2000];

interface ErrorLike {
  name?: string;
  message?: string;
}

function isErrorLike(error: unknown): error is ErrorLike {
  return typeof error === 'object' && error !== null;
}

export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  const err = isErrorLike(error) ? error : undefined;

  // Don't retry if manually aborted via signal
  if (err?.name === 'AbortError' && err.message?.includes('user')) {
    return false;
  }

  const message = typeof err?.message === 'string' ? err.message : String(error);

  // Check for HTTP status codes
  const statusMatch = message.match(/HTTP\s+(\d{3})/i);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    // 4xx errors (client / auth) are NOT transient - do not retry
    if (status >= 400 && status < 500) {
      return false;
    }
    // 5xx errors are server errors - retry
    if (status >= 500) {
      return true;
    }
  }

  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return true;
  return /network|failed to fetch|timed out|idle for|ECONNRESET|socket/i.test(message);
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const delays = options.delays || DEFAULT_RETRY_DELAYS;
  const maxRetries = options.maxRetries ?? delays.length;
  const isRetryable = options.isRetryable || isTransientError;
  const sleep = options.sleepFn || defaultSleep;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw options.signal.reason || new Error('Aborted');
    }

    try {
      return await fn(attempt);
    } catch (err: unknown) {
      lastError = err;

      if (options.signal?.aborted) {
        throw err;
      }

      if (attempt >= maxRetries || !isRetryable(err)) {
        throw err;
      }

      const delayMs = delays[attempt] ?? delays[delays.length - 1];
      await sleep(delayMs);
    }
  }

  throw lastError;
}

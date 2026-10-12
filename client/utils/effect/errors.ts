/**
 * Module: client/utils/effect/errors
 * Intent: Typed deep-exception taxonomy for Effect 4.0 error channels.
 * Responsibilities:
 *  - Tagged errors compatible with Effect.catchTag / catchReason (v4).
 *  - Mirrors existing retry.ts transient semantics + sse.ts event shapes.
 *  - Backend SSE `error` / `auth_required` contract alignment (Python stays native).
 */

import { Data } from 'effect';

export class RateLimitError extends Data.TaggedError('RateLimitError')<{
  readonly message: string;
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}> {}

export class QuotaExceededError extends Data.TaggedError('QuotaExceededError')<{
  readonly message: string;
  readonly limit?: number;
  readonly cause?: unknown;
}> {}

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly message: string;
  readonly timeoutMs: number;
  readonly cause?: unknown;
}> {}

export class ServerError extends Data.TaggedError('ServerError')<{
  readonly message: string;
  readonly status: number;
  readonly body?: string;
  readonly reason?: RateLimitError | QuotaExceededError;
  readonly cause?: unknown;
}> {}

export class AuthError extends Data.TaggedError('AuthError')<{
  readonly message: string;
  readonly provider: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export class ClientError extends Data.TaggedError('ClientError')<{
  readonly message: string;
  readonly status: number;
  readonly body?: string;
  readonly cause?: unknown;
}> {}

export class StreamError extends Data.TaggedError('StreamError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class StorageError extends Data.TaggedError('StorageError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class UnknownError extends Data.TaggedError('UnknownError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type AppError =
  | RateLimitError
  | QuotaExceededError
  | NetworkError
  | TimeoutError
  | ServerError
  | AuthError
  | ClientError
  | StreamError
  | StorageError
  | UnknownError;

const TRANSIENT_PATTERNS =
  /network|failed to fetch|timed out|idle for|ECONNRESET|socket/i;

export const isTransientAppError = (error: unknown): boolean => {
  if (error instanceof NetworkError) return true;
  if (error instanceof TimeoutError) return true;
  if (error instanceof ServerError) return error.status >= 500;
  if (error instanceof RateLimitError) return true;
  if (error instanceof ClientError) return false;
  if (error instanceof AuthError) return false;
  if (error instanceof StreamError) return false;
  if (error instanceof StorageError) return false;
  if (error instanceof UnknownError) {
    return TRANSIENT_PATTERNS.test(error.message);
  }
  return false;
};

export const fromUnknown = (error: unknown, fallback = 'Unknown error'): UnknownError => {
  if (error instanceof Error) {
    return new UnknownError({ message: error.message || fallback, cause: error });
  }
  if (typeof error === 'string') {
    return new UnknownError({ message: error });
  }
  return new UnknownError({ message: fallback, cause: error });
};

export const httpStatusToError = (
  status: number,
  body: string,
  opts?: { provider?: string }
): ServerError | ClientError | AuthError | RateLimitError => {
  const message = `Server returned HTTP ${status}: ${body}`;
  if (status === 429) {
    return new RateLimitError({ message, cause: { status, body } });
  }
  if (status === 401 || status === 403) {
    return new AuthError({ message, provider: opts?.provider ?? 'google', status, cause: { status, body } });
  }
  if (status >= 500) {
    return new ServerError({ message, status, body });
  }
  return new ClientError({ message, status, body });
};

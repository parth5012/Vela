/**
 * Module: client/utils/effect/sseEffect
 * Intent: Effect 4.0 pilot for SSE stream boundary (wraps sse.ts throw sites).
 * Responsibilities:
 *  - Classify stream failures into typed AppError (v4 catchTag/catchReason-ready).
 *  - Effect.tryPromise fetch wrapper + !ok response mapper.
 *  - Defect boundary helper (catchDefect only where continuing is safe).
 */

import { Effect } from 'effect';
import {
  AppError,
  AuthError,
  ClientError,
  NetworkError,
  StreamError,
  TimeoutError,
  UnknownError,
  fromUnknown,
  httpStatusToError,
} from './errors';
import { EMPTY_RESPONSE_ERROR_HINT } from '../reasoning';

export const DEFAULT_STREAM_TIMEOUT_MS = 90000;

const TIMEOUT_PATTERNS = /timed out|idle for|TimeoutError/i;
const NETWORK_PATTERNS = /network|failed to fetch|ECONNRESET|socket/i;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);

export const mapStreamFailure = (
  error: unknown,
  opts?: { readonly timeoutMs?: number; readonly provider?: string }
): AppError => {
  const message = messageOf(error);
  const name = error instanceof Error ? error.name : undefined;

  if (message === EMPTY_RESPONSE_ERROR_HINT) {
    return new StreamError({ message, cause: error });
  }
  if (/API URL is not configured/i.test(message)) {
    return new ClientError({ message, status: 400, cause: error });
  }
  if (/Response body is not readable/i.test(message)) {
    return new StreamError({ message, cause: error });
  }

  const statusMatch = message.match(/HTTP\s+(\d{3})/i);
  if (statusMatch) {
    return httpStatusToError(parseInt(statusMatch[1], 10), message, {
      provider: opts?.provider,
    });
  }

  if (name === 'TimeoutError' || TIMEOUT_PATTERNS.test(message)) {
    return new TimeoutError({
      message,
      timeoutMs: opts?.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS,
      cause: error,
    });
  }
  if (name === 'AbortError') {
    if (/user/i.test(message)) {
      return new UnknownError({ message: 'Request cancelled by user', cause: error });
    }
    return new NetworkError({ message, cause: error });
  }
  if (NETWORK_PATTERNS.test(message)) {
    return new NetworkError({ message, cause: error });
  }
  return fromUnknown(error, message || 'Stream request failed');
};

export const tryFetchEffect = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  opts?: { readonly timeoutMs?: number; readonly provider?: string }
): Effect.Effect<Response, AppError> =>
  Effect.tryPromise({
    try: () => fetch(input, init),
    catch: (cause) => mapStreamFailure(cause, opts),
  });

export const checkResponseEffect = (
  response: Response,
  opts?: { readonly provider?: string }
): Effect.Effect<Response, AppError> =>
  Effect.gen(function* () {
    if (response.ok) return response;
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => fromUnknown(cause, 'Unable to read error body'),
    }).pipe(Effect.catch(() => Effect.succeed('Unable to read error body')));
    const typed = httpStatusToError(response.status, body, { provider: opts?.provider });
    return yield* Effect.fail(typed);
  });

export const withDefectBoundary = <A, E>(
  effect: Effect.Effect<A, E>,
  opts?: { readonly provider?: string }
): Effect.Effect<A, E | UnknownError> =>
  effect.pipe(
    Effect.catchDefect((defect) =>
      Effect.fail(
        new UnknownError({
          message: `Stream defect boundary${opts?.provider ? ` (${opts.provider})` : ''}`,
          cause: defect,
        })
      )
    )
  );

export const isAuthRequiredMessage = (error: unknown): string | null => {
  const message = messageOf(error);
  const match = message.match(/auth_required(?::\s*(\w+))?/i);
  if (match) return match[1] ?? 'google';
  if (error instanceof AuthError) return error.provider;
  return null;
};

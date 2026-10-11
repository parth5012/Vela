/**
 * Module: client/utils/effect/retryEffect
 * Intent: Effect 4.0 retry pilot preserving retry.ts transient semantics.
 * Responsibilities:
 *  - Effect.retry + Schedule wrapper (v4 catch/catchFilter, never catchAll).
 *  - Exact delays [250,500,1000,2000] via Schedule.recurs + addDelay.
 *  - Promise-compat bridge delegating classification to isTransientError.
 */

import { Duration, Effect, Schedule } from 'effect';
import { isTransientError } from '../retry';
import { fromUnknown, isTransientAppError } from './errors';

export const DEFAULT_EFFECT_DELAYS = [250, 500, 1000, 2000];

export const delaysToSchedule = (
  delays: number[] = DEFAULT_EFFECT_DELAYS,
  times?: number
): Schedule.Schedule<number, unknown> => {
  const retries = Math.max(times ?? delays.length, 0);
  return Schedule.recurs(retries).pipe(
    Schedule.addDelay((meta) => {
      const delayMs = delays[Math.min(meta.attempt, delays.length - 1)] ?? 1000;
      return Effect.succeed(Duration.millis(delayMs));
    })
  );
};

export interface RetryEffectOptions<E = unknown> {
  readonly delays?: number[];
  readonly maxRetries?: number;
  readonly while?: (error: E) => boolean;
  readonly schedule?: Schedule.Schedule<unknown, E>;
}

export const retryWithEffect = <A, E>(
  effect: Effect.Effect<A, E>,
  options: RetryEffectOptions<E> = {}
): Effect.Effect<A, E> => {
  const delays = options.delays ?? DEFAULT_EFFECT_DELAYS;
  const times = options.maxRetries ?? delays.length;
  const schedule = options.schedule ?? delaysToSchedule(delays, times);
  const isRetryable = (options.while ?? (isTransientAppError as (error: E) => boolean)) as (
    error: E
  ) => boolean;
  return Effect.retry(effect, { while: isRetryable, schedule });
};

export interface RetryPromiseOptions {
  readonly delays?: number[];
  readonly maxRetries?: number;
  readonly signal?: AbortSignal;
  readonly isRetryable?: (error: unknown) => boolean;
}

export const withRetryEffect = async <T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryPromiseOptions = {}
): Promise<T> => {
  const delays = options.delays ?? DEFAULT_EFFECT_DELAYS;
  const maxRetries = options.maxRetries ?? delays.length;
  const isRetryable = options.isRetryable ?? isTransientError;
  let attempt = 0;

  const program = retryWithEffect(
    Effect.tryPromise({
      try: () => {
        if (options.signal?.aborted) {
          throw options.signal.reason ?? new Error('Aborted');
        }
        return fn(attempt++);
      },
      catch: (cause) => fromUnknown(cause),
    }),
    {
      delays: delays.slice(0, maxRetries),
      maxRetries,
      while: (typed) => {
        const original = (typed as { readonly cause?: unknown }).cause ?? typed;
        if (options.signal?.aborted) return false;
        return isRetryable(original);
      },
    }
  );

  try {
    return await Effect.runPromise(program as Effect.Effect<T, unknown>);
  } catch (typed) {
    const original = (typed as { readonly cause?: unknown }).cause;
    throw (original ?? typed) as unknown;
  }
};

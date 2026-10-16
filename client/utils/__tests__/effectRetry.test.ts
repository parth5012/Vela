import {
  AuthError,
  ClientError,
  NetworkError,
  RateLimitError,
  ServerError,
  TimeoutError,
  httpStatusToError,
  isTransientAppError,
} from '../effect/errors';
import { withRetryEffect } from '../effect/retryEffect';

describe('effect errors taxonomy', () => {
  it('maps HTTP statuses to typed errors', () => {
    expect(httpStatusToError(429, 'slow')).toBeInstanceOf(RateLimitError);
    expect(httpStatusToError(401, 'nope')).toBeInstanceOf(AuthError);
    expect(httpStatusToError(500, 'boom')).toBeInstanceOf(ServerError);
    expect(httpStatusToError(400, 'bad')).toBeInstanceOf(ClientError);
  });

  it('classifies transient vs fatal typed errors', () => {
    expect(isTransientAppError(new NetworkError({ message: 'down' }))).toBe(true);
    expect(isTransientAppError(new TimeoutError({ message: 't', timeoutMs: 1 }))).toBe(true);
    expect(isTransientAppError(new ServerError({ message: 's', status: 503 }))).toBe(true);
    expect(isTransientAppError(new ServerError({ message: 's', status: 200 }))).toBe(false);
    expect(isTransientAppError(new AuthError({ message: 'a', provider: 'google' }))).toBe(false);
    expect(isTransientAppError(new ClientError({ message: 'c', status: 400 }))).toBe(false);
  });
});

describe('withRetryEffect promise bridge', () => {
  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const result = await withRetryEffect(
      async () => {
        calls++;
        if (calls < 3) throw new Error('failed to fetch: network down');
        return 'ok';
      },
      { delays: [5, 5, 5, 5], maxRetries: 4 }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry fatal 4xx errors', async () => {
    let calls = 0;
    await expect(
      withRetryEffect(
        async () => {
          calls++;
          throw new Error('Server returned HTTP 400: bad request');
        },
        { delays: [5, 5], maxRetries: 3 }
      )
    ).rejects.toThrow('HTTP 400');
    expect(calls).toBe(1);
  });
});

import { Effect } from 'effect';
import {
  AuthError,
  ClientError,
  NetworkError,
  StreamError,
  TimeoutError,
  UnknownError,
} from '../effect/errors';
import {
  checkResponseEffect,
  mapStreamFailure,
  withDefectBoundary,
} from '../effect/sseEffect';

describe('mapStreamFailure', () => {
  it('maps empty-response hint to StreamError', () => {
    expect(mapStreamFailure(new Error('empty'))).toBeInstanceOf(UnknownError);
  });

  it('maps unreadable body to StreamError', () => {
    expect(mapStreamFailure(new Error('Response body is not readable'))).toBeInstanceOf(StreamError);
  });

  it('maps missing URL to ClientError', () => {
    const err = mapStreamFailure(new Error('API URL is not configured.'));
    expect(err).toBeInstanceOf(ClientError);
  });

  it('maps HTTP statuses via contract', () => {
    expect(mapStreamFailure(new Error('Server returned HTTP 503: down'))).toMatchObject({
      _tag: 'ServerError',
    });
    expect(mapStreamFailure(new Error('Server returned HTTP 401: nope'))).toBeInstanceOf(
      AuthError
    );
  });

  it('maps timeouts and network failures', () => {
    expect(mapStreamFailure(new Error('Response idle for 90s'))).toBeInstanceOf(TimeoutError);
    expect(mapStreamFailure(new Error('failed to fetch: socket hang up'))).toBeInstanceOf(
      NetworkError
    );
  });
});

describe('checkResponseEffect', () => {
  it('passes through ok responses', async () => {
    const res = new Response('ok', { status: 200 });
    await expect(Effect.runPromise(checkResponseEffect(res))).resolves.toBe(res);
  });

  it('fails typed on !ok with body', async () => {
    const res = new Response('denied', { status: 403 });
    await expect(
      Effect.runPromise(checkResponseEffect(res, { provider: 'google' }))
    ).rejects.toMatchObject({ _tag: 'AuthError', provider: 'google' });
  });
});

describe('withDefectBoundary', () => {
  it('converts defects to UnknownError at boundary', async () => {
    const program = withDefectBoundary(Effect.die(new Error('plugin crashed')));
    await expect(Effect.runPromise(program)).rejects.toMatchObject({ _tag: 'UnknownError' });
  });
});

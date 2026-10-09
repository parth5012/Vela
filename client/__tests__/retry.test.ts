import { withRetry, isTransientError } from '../utils/retry';

describe('retry utility', () => {
  it('retries up to specified count with exponential backoff delays', async () => {
    let attempts = 0;
    const recordedDelays: number[] = [];

    const mockSleep = jest.fn(async (ms: number) => {
      recordedDelays.push(ms);
    });

    const op = jest.fn(async () => {
      attempts++;
      if (attempts <= 4) {
        throw new Error('Server returned HTTP 503: Service Unavailable');
      }
      return 'success';
    });

    const result = await withRetry(op, {
      delays: [250, 500, 1000, 2000],
      sleepFn: mockSleep,
    });

    expect(result).toBe('success');
    expect(attempts).toBe(5); // initial attempt + 4 retries
    expect(recordedDelays).toEqual([250, 500, 1000, 2000]);
  });

  it('fails after exhausting maxRetries (4 retries = 5 attempts)', async () => {
    let attempts = 0;
    const op = jest.fn(async () => {
      attempts++;
      throw new Error('Server returned HTTP 500: Internal Server Error');
    });

    await expect(
      withRetry(op, {
        delays: [1, 2, 3, 4],
        sleepFn: jest.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('Server returned HTTP 500: Internal Server Error');

    expect(attempts).toBe(5);
  });

  it('does NOT retry on 4xx client/auth errors', async () => {
    let attempts = 0;
    const op = jest.fn(async () => {
      attempts++;
      throw new Error('Server returned HTTP 401: Unauthorized');
    });

    await expect(
      withRetry(op, {
        delays: [100, 200, 300, 400],
        sleepFn: jest.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('HTTP 401');

    expect(attempts).toBe(1); // No retry
  });

  it('stops retrying when signal is aborted', async () => {
    let attempts = 0;
    const controller = new AbortController();

    const op = jest.fn(async () => {
      attempts++;
      controller.abort();
      throw new Error('Network error');
    });

    await expect(
      withRetry(op, {
        signal: controller.signal,
        delays: [100, 200, 300, 400],
        sleepFn: jest.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow();

    expect(attempts).toBe(1);
  });

  describe('isTransientError', () => {
    it('treats 500, 502, 503, 504 as transient', () => {
      expect(isTransientError(new Error('Server returned HTTP 500: Error'))).toBe(true);
      expect(isTransientError(new Error('Server returned HTTP 503: Unavailable'))).toBe(true);
    });

    it('treats 400, 401, 403, 404 as non-transient', () => {
      expect(isTransientError(new Error('Server returned HTTP 400: Bad Request'))).toBe(false);
      expect(isTransientError(new Error('Server returned HTTP 401: Unauthorized'))).toBe(false);
      expect(isTransientError(new Error('Server returned HTTP 403: Forbidden'))).toBe(false);
      expect(isTransientError(new Error('Server returned HTTP 404: Not Found'))).toBe(false);
    });

    it('treats network errors as transient', () => {
      expect(isTransientError(new Error('Network request failed'))).toBe(true);
      expect(isTransientError(new Error('Failed to fetch'))).toBe(true);
    });
  });
});

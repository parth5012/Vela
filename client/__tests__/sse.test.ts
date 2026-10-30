import { streamAgentResponse } from '../utils/sse';
import { reset, snapshot } from '../utils/metrics';

describe('streamAgentResponse', () => {
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = (globalThis as any).fetch;
  });

  afterAll(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('should stream chunks and trigger events', async () => {
    const chunks: string[] = [];
    let completed = false;
    let title = '';

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "Hello"}\n\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done", "thread_title": "Greeting"}\n\n'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({
        ok: true,
        body: mockStream
      });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      (t) => { completed = true; title = t || ''; },
      () => {}
    );

    expect(chunks).toEqual(['Hello']);
    expect(completed).toBe(true);
    expect(title).toBe('Greeting');
  });

  it('should handle non-ok server response status by triggering onError', async () => {
    let errorOccurred = false;
    let errorMessage = '';

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve(''),
      });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      (err) => {
        errorOccurred = true;
        errorMessage = err.message;
      }
    );

    expect(errorOccurred).toBe(true);
    expect(errorMessage).toBe('Server returned HTTP 500: ');
  });

  it('should handle body stream reader unavailability', async () => {
    let errorOccurred = false;
    let errorMessage = '';

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        body: null,
      });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      (err) => {
        errorOccurred = true;
        errorMessage = err.message;
      }
    );

    expect(errorOccurred).toBe(true);
    expect(errorMessage).toBe('Response body is not readable');
  });

  it('should suppress onError for intentional aborts (pre-aborted signal)', async () => {
    let errorOccurred = false;

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    });

    const controller = new AbortController();
    controller.abort();

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      () => {
        errorOccurred = true;
      },
      controller.signal
    );

    expect(errorOccurred).toBe(false);
  });

  it('should still trigger onError when fetch rejects without external abort (timeout)', async () => {
    let errorOccurred = false;
    let errorMessage = '';

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });

    const controller = new AbortController();

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      (err) => {
        errorOccurred = true;
        errorMessage = err.message;
      },
      controller.signal
    );

    expect(errorOccurred).toBe(true);
    expect(errorMessage).toBe('The operation was aborted.');
  });

  it('should process non-newline-terminated final chunk in buffer when stream ends', async () => {
    const chunks: string[] = [];
    let completed = false;
    let title = '';

    reset();

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "Hello"}\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done", "thread_title": "Finished"}'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({
        ok: true,
        body: mockStream
      });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      (t) => { completed = true; title = t || ''; },
      () => {}
    );

    expect(chunks).toEqual(['Hello']);
    expect(completed).toBe(true);
    expect(title).toBe('Finished');

    // WF-501: a stream whose final done event arrives via the EOF buffer must be
    // counted as a success, not misrecorded under sse.failures.other.
    const snap = snapshot();
    expect(snap.counters['sse.attempts']).toBe(1);
    expect(snap.counters['sse.successes']).toBe(1);
    expect(snap.counters['sse.failures.other']).toBeUndefined();
  });

  it('should strip <think> reasoning blocks from stream and assembly', async () => {
    const chunks: string[] = [];
    let completed = false;

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "<think>pondering...</think>Hello "}\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "world!"}\n'), done: false };
              } else if (count === 2) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done", "thread_title": "Thought"}\n'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({ ok: true, body: mockStream });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      () => { completed = true; },
      () => {}
    );

    expect(chunks.join('')).toBe('Hello world!');
    expect(completed).toBe(true);
  });

  it('handles chunk-boundary split across <think> tags without leaking or losing characters', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "<th"}\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "ink>reasoning</think>Hello"}\n'), done: false };
              } else if (count === 2) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done"}\n'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({ ok: true, body: mockStream });
    });

    const chunks: string[] = [];
    let completed = false;

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      () => { completed = true; },
      () => {}
    );

    expect(completed).toBe(true);
    expect(chunks.join('')).toBe('Hello');
  });

  it('surfaces empty-response error when model returns only reasoning or whitespace', async () => {
    let error: Error | undefined;

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "<think>pondering only</think>"}\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done", "thread_title": "Empty"}\n'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({ ok: true, body: mockStream });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      (err) => { error = err; }
    );

    expect(error).toBeDefined();
    expect(error?.message).toContain('Empty response — try raising maxTokens');
  });

  it('surfaces empty-response error when model exhausts maxTokens inside unclosed <think> block', async () => {
    let error: Error | undefined;

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "<think>hit maxTokens before completing thought"}\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done"}\n'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({ ok: true, body: mockStream });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      (err) => { error = err; }
    );

    expect(error).toBeDefined();
    expect(error?.message).toContain('Empty response — try raising maxTokens');
  });

  it('retries up to 4 times with exponential backoff on transient errors', async () => {
    let callCount = 0;
    const recordedDelays: number[] = [];

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 4) {
        return Promise.resolve({
          ok: false,
          status: 502,
          text: () => Promise.resolve('Bad Gateway'),
        });
      }
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "Recovered!"}\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done"}\n'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({ ok: true, body: mockStream });
    });

    const chunks: string[] = [];
    let completed = false;

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      () => { completed = true; },
      () => {},
      undefined,
      undefined,
      undefined,
      90000,
      {
        delays: [10, 20, 30, 40],
        sleepFn: async (ms) => { recordedDelays.push(ms); },
      }
    );

    expect(callCount).toBe(5); // Initial attempt + 4 retries
    expect(recordedDelays).toEqual([10, 20, 30, 40]);
    expect(chunks.join('')).toBe('Recovered!');
    expect(completed).toBe(true);
  });

  it('does NOT retry if chunks have already been emitted (avoids replay)', async () => {
    let callCount = 0;
    const chunks: string[] = [];
    let error: Error | undefined;

    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      callCount++;
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return {
                  value: new TextEncoder().encode('data: {"type": "content", "delta": "Partial output"}\n\n'),
                  done: false,
                };
              }
              throw new Error('Network request failed');
            },
          };
        },
      };
      return Promise.resolve({ ok: true, body: mockStream });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      () => {},
      (err) => {
        error = err;
      },
      undefined,
      undefined,
      undefined,
      90000,
      {
        delays: [10, 20, 30, 40],
        sleepFn: jest.fn().mockResolvedValue(undefined),
      }
    );

    expect(callCount).toBe(1); // exactly 1 attempt, no retry
    expect(chunks).toEqual(['Partial output']); // chunk emitted exactly once
    expect(error?.message).toContain('Network request failed');
  });
});

describe('streamAgentResponse metrics (WF-501)', () => {
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = (globalThis as any).fetch;
  });

  afterAll(() => {
    (globalThis as any).fetch = originalFetch;
  });

  beforeEach(() => {
    reset();
  });

  interface StreamScript {
    /** Encoded SSE segments to deliver, one per read() call. */
    segments?: string[];
    /** Error thrown by read() after `segments` are exhausted. */
    readError?: Error;
    /** Non-ok HTTP response instead of a stream. */
    httpStatus?: number;
  }

  const mockFetchStream = (script: StreamScript) => {
    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      if (script.httpStatus !== undefined) {
        return Promise.resolve({
          ok: false,
          status: script.httpStatus,
          text: () => Promise.resolve(''),
        });
      }
      const mockStream = {
        getReader() {
          let i = 0;
          const segments = script.segments ?? [];
          return {
            async read() {
              if (i >= segments.length) {
                if (script.readError) throw script.readError;
                return { value: undefined, done: true };
              }
              const value = new TextEncoder().encode(segments[i]);
              i++;
              return { value, done: false };
            },
          };
        },
      };
      return Promise.resolve({ ok: true, body: mockStream });
    });
  };

  it('records attempt/success counters and transport metrics on a successful stream', async () => {
    const segments = [
      'data: {"type": "content", "delta": "Hello"}\n\n',
      'data: {"type": "done", "thread_title": "Greeting"}\n\n',
    ];
    mockFetchStream({ segments });
    const transportBytes = segments.reduce(
      (sum, s) => sum + new TextEncoder().encode(s).length,
      0
    );
    const bodyBytes = new TextEncoder().encode(
      JSON.stringify({ thread_id: 'thread-1', message: 'hi', agent: 'personal assistant' })
    ).length;

    const chunks: string[] = [];
    let completed = false;
    let title = '';

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      (t) => { completed = true; title = t || ''; },
      () => {}
    );

    expect(chunks).toEqual(['Hello']);
    expect(completed).toBe(true);
    expect(title).toBe('Greeting');

    const snap = snapshot();
    expect(snap.counters['sse.attempts']).toBe(1);
    expect(snap.counters['sse.successes']).toBe(1);
    expect(snap.counters['sse.failures.http_error']).toBeUndefined();

    // One sample per attempt for each transport metric.
    expect(snap.stats['sse.request_bytes']).toMatchObject({ count: 1, max: bodyBytes });
    expect(snap.stats['sse.bytes_received']).toMatchObject({ count: 1, max: transportBytes });
    expect(snap.stats['sse.chunk_count']).toMatchObject({ count: 1, max: 2 });
    expect(snap.stats['sse.ttfc']).toMatchObject({ count: 1 });
    expect(snap.stats['sse.idle_gap_max']).toMatchObject({ count: 1 });
    expect(snap.stats['sse.turn_duration']).toMatchObject({ count: 1 });
  });

  it('records a failure counter with error type on an HTTP error (no retry)', async () => {
    mockFetchStream({ httpStatus: 500 });

    let errorOccurred = false;
    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      () => { errorOccurred = true; },
      undefined,
      undefined,
      undefined,
      90000,
      { maxRetries: 0, sleepFn: jest.fn().mockResolvedValue(undefined) }
    );

    expect(errorOccurred).toBe(true);

    const snap = snapshot();
    expect(snap.counters['sse.attempts']).toBe(1);
    expect(snap.counters['sse.failures.http_error']).toBe(1);
    expect(snap.counters['sse.successes']).toBeUndefined();

    // Attempt metrics are still recorded for the failed attempt (counts only).
    expect(snap.stats['sse.request_bytes']).toMatchObject({
      count: 1,
      max: new TextEncoder().encode(
        JSON.stringify({ thread_id: 'thread-1', message: 'hi', agent: 'personal assistant' })
      ).length,
    });
    expect(snap.stats['sse.bytes_received']).toMatchObject({ count: 1, max: 0 });
    expect(snap.stats['sse.chunk_count']).toMatchObject({ count: 1, max: 0 });
    // TTFC is only recorded when at least one byte was received; this attempt
    // failed with an HTTP error before any bytes arrived, so no TTFC sample.
    expect(snap.stats['sse.ttfc']).toBeUndefined();
    expect(snap.stats['sse.idle_gap_max']).toMatchObject({ count: 1 });
    expect(snap.stats['sse.turn_duration']).toMatchObject({ count: 1 });
  });

  it('counts one failure per attempt across retries and a success on the final attempt', async () => {
    let callCount = 0;
    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        });
      }
      return Promise.resolve({
        ok: true,
        body: {
          getReader() {
            let i = 0;
            const segments = ['data: {"type": "content", "delta": "OK!"}\n', 'data: {"type": "done"}\n'];
            return {
              async read() {
                if (i >= segments.length) return { value: undefined, done: true };
                const value = new TextEncoder().encode(segments[i]);
                i++;
                return { value, done: false };
              },
            };
          },
        },
      });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      90000,
      { maxRetries: 2, sleepFn: jest.fn().mockResolvedValue(undefined) }
    );

    expect(callCount).toBe(3);

    const snap = snapshot();
    expect(snap.counters['sse.attempts']).toBe(3);
    expect(snap.counters['sse.failures.http_error']).toBe(2);
    expect(snap.counters['sse.successes']).toBe(1);
  });

  it('records a failure counter with error type when the server emits an error event', async () => {
    mockFetchStream({ segments: ['data: {"type": "error", "message": "boom"}\n\n'] });

    let errorOccurred = false;
    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      () => { errorOccurred = true; }
    );

    expect(errorOccurred).toBe(true);

    const snap = snapshot();
    expect(snap.counters['sse.attempts']).toBe(1);
    expect(snap.counters['sse.failures.server_error']).toBe(1);
    expect(snap.counters['sse.successes']).toBeUndefined();
  });

  it('records a failure counter with error type when the body stream is unreadable', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({ ok: true, body: null });
    });

    let errorOccurred = false;
    let errorMessage = '';
    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      () => {},
      () => {},
      (err) => { errorOccurred = true; errorMessage = err.message; }
    );

    expect(errorOccurred).toBe(true);
    expect(errorMessage).toBe('Response body is not readable');

    const snap = snapshot();
    expect(snap.counters['sse.attempts']).toBe(1);
    expect(snap.counters['sse.failures.network_error']).toBe(1);
    expect(snap.counters['sse.successes']).toBeUndefined();
  });
});

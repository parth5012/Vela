import { streamAgentResponse } from '../utils/sse';

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

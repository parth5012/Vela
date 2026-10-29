/**
 * WF-499-03: SSE transport perf budgets — request body bytes + chunk count.
 *
 * TEST-ONLY suite: guards the SSE request payload size budget (≤ 4 KB) without
 * touching `utils/sse.ts`. Budgets are byte/count-based; there are NO
 * wall-clock assertions in this file (no timing deltas are measured).
 *
 * Two layers of guard:
 *  1. A local builder that mirrors — byte for byte — how
 *     `executeStreamRequest` (utils/sse.ts) constructs the POST body:
 *     `{ thread_id, message, agent }`, defaulting agent to
 *     'personal assistant' and conditionally adding `stream_generation`.
 *  2. The real `streamAgentResponse` running against a mocked `fetch`,
 *     capturing the actual serialized request body off the wire and the
 *     `sse.chunk_count` metric it records for a synthetic 600-delta turn.
 *
 * Chunk-count budget rationale: `sse.chunk_count` counts parsed SSE `data:`
 * events per attempt — one per `content` delta plus one `done` terminator
 * per successful turn, plus at most a handful of server control events
 * (`auth_required`, etc.). A 600-delta turn therefore records 601; the
 * budget of 610 is a deliberately generous upper bound (~10 control events
 * of slack) and is not a transport-imposed limit.
 */

import { streamAgentResponse } from '../utils/sse';
import { reset, snapshot } from '../utils/metrics';

/** SSE request body budget (bytes). Ticket: ≤ 4 KB. */
const REQUEST_BODY_BUDGET_BYTES = 4096;

/**
 * Generous chunk-count budget for a 600-delta synthetic turn: 600 content
 * deltas + 1 `done` event + slack for server control events (see header).
 */
const CHUNK_COUNT_BUDGET_600_DELTA = 610;

const encodeBytes = (text: string): number =>
  typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text).length
    : Buffer.from(text, 'utf8').length;

interface SseRequestPayload {
  threadId: string;
  message: string;
  agent?: string;
  streamGeneration?: number;
}

/**
 * Builds the POST body exactly as `executeStreamRequest` does in
 * utils/sse.ts (agent default, conditional stream_generation > 0) and
 * returns the serialized text plus its UTF-8 byte length.
 */
function buildSseRequestBody(payload: SseRequestPayload): { text: string; bytes: number } {
  const bodyObj: Record<string, unknown> = {
    thread_id: payload.threadId,
    message: payload.message,
    agent: payload.agent || 'personal assistant',
  };
  if (payload.streamGeneration !== undefined && payload.streamGeneration > 0) {
    bodyObj.stream_generation = payload.streamGeneration;
  }
  const text = JSON.stringify(bodyObj);
  return { text, bytes: encodeBytes(text) };
}

describe('SSE perf budgets (WF-499-03)', () => {
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

  describe('request body bytes budget (≤ 4096)', () => {
    it('a realistic 200-char user message payload stays within the 4 KB budget', () => {
      // Representative turn: realistic UUID-ish thread id, default agent,
      // and a 200-character user message.
      const message =
        'Can you summarize this week and remind me what I promised the team about the release, ' +
        'including the open blockers, the demo date, and the follow-ups I still owe from yesterday?';
      const { text, bytes } = buildSseRequestBody({
        threadId: 'a1b2c3d4-e5f6-7890-abcd-1234567890ef',
        message,
      });

      console.log(`[sse.perf] realistic 200-char message: ${text.length} chars, ${bytes} bytes`);
      expect(bytes).toBeLessThanOrEqual(REQUEST_BODY_BUDGET_BYTES);
    });

    it('payload with explicit agent and stream_generation stays within the budget', () => {
      const message =
        'Refactor the retry loop and explain the tradeoffs between exponential backoff and ' +
        'jittered retries for a flaky SSE endpoint under mobile network conditions, please.';
      const { bytes } = buildSseRequestBody({
        threadId: 'a1b2c3d4-e5f6-7890-abcd-1234567890ef',
        message,
        agent: 'release manager',
        streamGeneration: 7,
      });

      console.log(`[sse.perf] 200-char message + agent + stream_generation: ${bytes} bytes`);
      expect(bytes).toBeLessThanOrEqual(REQUEST_BODY_BUDGET_BYTES);
    });

    it('default-agent payload (agent omitted → "personal assistant") stays within the budget', () => {
      const { bytes } = buildSseRequestBody({
        threadId: 'thread-1',
        message: 'hi',
      });

      console.log(`[sse.perf] minimal '{threadId:"thread-1", message:"hi"}' body: ${bytes} bytes`);
      expect(bytes).toBeLessThanOrEqual(REQUEST_BODY_BUDGET_BYTES);
      // Sanity: the builder mirrors the sse.ts default agent.
      expect(JSON.parse(buildSseRequestBody({ threadId: 'thread-1', message: 'hi' }).text).agent).toBe(
        'personal assistant'
      );
    });

    it('the actual on-the-wire request body matches the mirrored builder and fits the budget', async () => {
      let capturedBody: string | undefined;

      // Capture the serialized body passed to fetch by sse.ts itself.
      (globalThis as any).fetch = jest.fn(
        (_url: string, options: any): Promise<any> => {
          capturedBody = options.body;
          const mockStream = {
            getReader() {
              let drained = false;
              return {
                async read() {
                  if (drained) return { value: undefined, done: true };
                  drained = true;
                  return {
                    value: new TextEncoder().encode(
                      'data: {"type": "content", "delta": "Hello"}\n\n' +
                        'data: {"type": "done", "thread_title": "Greeting"}\n\n'
                    ),
                    done: false,
                  };
                },
              };
            },
          };
          return Promise.resolve({ ok: true, body: mockStream });
        }
      );

      const message =
        'Can you summarize this week and remind me what I promised the team about the release, ' +
        'including the open blockers, the demo date, and the follow-ups I still owe from yesterday?';

      await streamAgentResponse(
        'https://example.com',
        'test-key',
        'a1b2c3d4-e5f6-7890-abcd-1234567890ef',
        message,
        () => {},
        () => {},
        () => {}
      );

      expect(capturedBody).toBeDefined();
      const wireBytes = encodeBytes(capturedBody!);
      const mirrored = buildSseRequestBody({
        threadId: 'a1b2c3d4-e5f6-7890-abcd-1234567890ef',
        message,
      });
      console.log(
        `[sse.perf] actual request body from streamAgentResponse: ${wireBytes} bytes; mirrored builder: ${mirrored.bytes} bytes`
      );

      // The transport must serialize exactly what the mirrored builder produces.
      expect(capturedBody).toBe(mirrored.text);
      expect(wireBytes).toBe(mirrored.bytes);
      expect(wireBytes).toBeLessThanOrEqual(REQUEST_BODY_BUDGET_BYTES);
    });
  });

  describe('chunk-count bound (600-delta synthetic turn)', () => {
    it('records sse.chunk_count ≤ 610 for a 600-content-delta turn', async () => {
      // Synthetic turn: 600 individual content delta events followed by one
      // `done` event. Each read returns exactly one SSE data event, matching
      // how the transport normally delivers deltas.
      const TOTAL_DELTAS = 600;

      (globalThis as any).fetch = jest.fn().mockImplementation(() => {
        const encoder = new TextEncoder();
        const contentLine = 'data: {"type": "content", "delta": "tok"}\n\n';
        const doneLine = 'data: {"type": "done", "thread_title": "Long"}\n\n';
        let count = 0;
        const mockStream = {
          getReader() {
            return {
              async read() {
                if (count < TOTAL_DELTAS) {
                  count++;
                  return { value: encoder.encode(contentLine), done: false };
                }
                if (count === TOTAL_DELTAS) {
                  count++;
                  return { value: encoder.encode(doneLine), done: false };
                }
                return { value: undefined, done: true };
              },
            };
          },
        };
        return Promise.resolve({ ok: true, body: mockStream });
      });

      let error: Error | null = null;
      await streamAgentResponse(
        'https://example.com',
        'test-key',
        'thread-600',
        'long turn please',
        () => {},
        () => {},
        (err) => {
          error = err;
        }
      );

      expect(error).toBeNull();

      // streamAgentResponse records sse.chunk_count per attempt in the
      // metrics buffer (600 deltas + 1 done = 601 samples of the same name
      // collapse into one stat entry).
      const stats = snapshot().stats['sse.chunk_count'];
      expect(stats).toBeDefined();
      expect(stats!.count).toBe(1);
      expect(stats!.max).toBe(TOTAL_DELTAS + 1); // 601 — exact expected value

      // Generous budget from the ticket: 600 deltas + slack for control events.
      expect(stats!.max).toBeLessThanOrEqual(CHUNK_COUNT_BUDGET_600_DELTA);
    });
  });
});

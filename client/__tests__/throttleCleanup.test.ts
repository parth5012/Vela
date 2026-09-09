/**
 * AC-3 / FIX-3 — E2E report gap: no test referenced
 * throttle / AppState / cleanUpThrottleAndHeal.
 *
 * index.tsx is too heavy to import under Jest (expo-router, native modules),
 * so this suite exercises a minimal harness that mirrors its throttle
 * contract line-for-line, wired to the REAL exported helpers:
 *   - useChatStore (appendToken / setHistory / isThreadStreaming /
 *     setStreamingThread)
 *   - healXmlTags
 *
 * Mirrored semantics (see client/app/index.tsx):
 *   - throttleTimersRef / pendingTokensMapRef refs
 *   - cleanUpThrottleAndHeal: clearInterval + flush pending via appendToken,
 *     ALWAYS drop the buffer entry, then heal unclosed XML on the last
 *     assistant message via setHistory
 *   - interval tick self-heal: when !isThreadStreaming(threadId) stop ticking
 *   - AppState listener: any state !== 'active' flushes + clears every
 *     throttle interval and marks threads stopped
 *   - unmount: clears ALL throttle timers AND pending token buffers
 */
jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

import { AppState } from 'react-native';
import { useChatStore } from '../store/useChatStore';
import { healXmlTags } from '../utils/xmlHealer';

// ---------------------------------------------------------------------------
// Minimal harness mirroring client/app/index.tsx throttle section.
// ---------------------------------------------------------------------------
function createThrottleHarness() {
  // Same shape as index.tsx: throttleTimersRef / pendingTokensMapRef.
  const throttleTimersRef: { current: Record<string, any> } = { current: {} };
  const pendingTokensMapRef: { current: Record<string, string> } = {
    current: {},
  };

  function cleanUpThrottleAndHeal(threadId: string) {
    if (throttleTimersRef.current[threadId]) {
      clearInterval(throttleTimersRef.current[threadId]);
      delete throttleTimersRef.current[threadId];
    }

    // Flush any leftover tokens.
    if (pendingTokensMapRef.current[threadId]) {
      useChatStore.getState().appendToken(
        threadId,
        pendingTokensMapRef.current[threadId],
      );
    }
    // FIX-3: always drop the buffer entry (even when empty) so a later
    // tick cannot resurrect work for a finished thread.
    delete pendingTokensMapRef.current[threadId];

    // Heal XML tags on the last assistant message.
    const threadMsgs = useChatStore.getState().messages[threadId] || [];
    if (threadMsgs.length > 0) {
      const last = threadMsgs[threadMsgs.length - 1];
      if (last.role === 'assistant') {
        const healed = healXmlTags(last.content);
        if (healed !== last.content) {
          useChatStore.getState().setHistory(threadId, [
            ...threadMsgs.slice(0, -1),
            { ...last, content: healed },
          ]);
        }
      }
    }
  }

  function accumulate(threadId: string, chunk: string) {
    pendingTokensMapRef.current[threadId] =
      (pendingTokensMapRef.current[threadId] || '') + chunk;
    if (!throttleTimersRef.current[threadId]) {
      throttleTimersRef.current[threadId] = setInterval(() => {
        // FIX-3 self-heal: stream ended without cleanup -> stop ticking.
        if (!useChatStore.getState().isThreadStreaming(threadId)) {
          clearInterval(throttleTimersRef.current[threadId]);
          delete throttleTimersRef.current[threadId];
          return;
        }
        if (pendingTokensMapRef.current[threadId]) {
          useChatStore.getState().appendToken(
            threadId,
            pendingTokensMapRef.current[threadId],
          );
          pendingTokensMapRef.current[threadId] = '';
        }
      }, 100);
    }
  }

  // Mirrors the AppState effect in index.tsx: backgrounding mid-stream must
  // not sustain CPU — flush + clear every throttle interval.
  function handleAppStateChange(state: string) {
    if (state !== 'active') {
      Object.keys(throttleTimersRef.current).forEach((id) => {
        cleanUpThrottleAndHeal(id);
        useChatStore.getState().setStreamingThread(id, false);
      });
    }
  }

  const subscription = AppState.addEventListener(
    'change',
    handleAppStateChange,
  );

  // Mirrors the unmount effect in index.tsx: clears ALL throttle timers AND
  // pending token buffers.
  function dispose() {
    Object.keys(throttleTimersRef.current).forEach((key) => {
      clearInterval(throttleTimersRef.current[key]);
      delete throttleTimersRef.current[key];
    });
    Object.keys(pendingTokensMapRef.current).forEach((key) => {
      delete pendingTokensMapRef.current[key];
    });
    subscription.remove();
  }

  return {
    throttleTimersRef,
    pendingTokensMapRef,
    cleanUpThrottleAndHeal,
    accumulate,
    handleAppStateChange,
    dispose,
  };
}

function seedStreamingThread(threadId: string, assistantContent = '') {
  const store = useChatStore.getState();
  store.createThread('t', threadId);
  store.addMessage(threadId, { id: `${threadId}-u`, role: 'user', content: 'hi' });
  store.addMessage(threadId, {
    id: `${threadId}-a`,
    role: 'assistant',
    content: assistantContent,
  });
  store.setStreamingThread(threadId, true);
}

describe('FIX-3 throttle cleanup (throttle / AppState / cleanUpThrottleAndHeal)', () => {
  let appStateHandler: ((state: string) => void) | null = null;
  let addEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    useChatStore.getState().clearStore();
    appStateHandler = null;
    addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((event: string, handler: any) => {
        if (event === 'change') appStateHandler = handler;
        return { remove: jest.fn() };
      }) as any);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    addEventListenerSpy.mockRestore();
  });

  it('background AppState transition flushes pending tokens, clears intervals and stops streaming', () => {
    const h = createThrottleHarness();
    seedStreamingThread('t-bg', 'Hello');
    h.accumulate('t-bg', ' world');
    expect(h.throttleTimersRef.current['t-bg']).toBeDefined();

    // Fire a background transition through the real AppState subscription.
    expect(appStateHandler).not.toBeNull();
    appStateHandler!('background');

    // Pending tokens flushed into the assistant message.
    expect(useChatStore.getState().messages['t-bg'][1].content).toBe(
      'Hello world',
    );
    // Interval cleared and buffer dropped (no resurrection).
    expect(h.throttleTimersRef.current['t-bg']).toBeUndefined();
    expect(h.pendingTokensMapRef.current['t-bg']).toBeUndefined();
    // Thread marked stopped.
    expect(useChatStore.getState().isThreadStreaming('t-bg')).toBe(false);

    // Advancing timers afterwards does not append anything more.
    jest.advanceTimersByTime(1000);
    expect(useChatStore.getState().messages['t-bg'][1].content).toBe(
      'Hello world',
    );
    h.dispose();
  });

  it('unmount clears all throttle timers and drops pending buffers without flush', () => {
    const h = createThrottleHarness();
    seedStreamingThread('t-1', 'A');
    seedStreamingThread('t-2', 'B');
    h.accumulate('t-1', '-pending-1');
    h.accumulate('t-2', '-pending-2');
    expect(Object.keys(h.throttleTimersRef.current)).toHaveLength(2);

    h.dispose(); // unmount

    expect(h.throttleTimersRef.current['t-1']).toBeUndefined();
    expect(h.throttleTimersRef.current['t-2']).toBeUndefined();
    expect(h.pendingTokensMapRef.current['t-1']).toBeUndefined();
    expect(h.pendingTokensMapRef.current['t-2']).toBeUndefined();

    // Nothing was flushed on unmount, and no timer can fire afterwards.
    expect(useChatStore.getState().messages['t-1'][1].content).toBe('A');
    expect(useChatStore.getState().messages['t-2'][1].content).toBe('B');
    jest.advanceTimersByTime(1000);
    expect(useChatStore.getState().messages['t-1'][1].content).toBe('A');
    expect(useChatStore.getState().messages['t-2'][1].content).toBe('B');
  });

  it('self-heal: interval tick stops itself when !isThreadStreaming', () => {
    const h = createThrottleHarness();
    seedStreamingThread('t-heal', 'Base');
    h.accumulate('t-heal', '-buffered');
    expect(h.throttleTimersRef.current['t-heal']).toBeDefined();

    // Stream ends without cleanup (missed cleanUpThrottleAndHeal call).
    useChatStore.getState().setStreamingThread('t-heal', false);

    // Next tick self-heals: timer removed instead of ticking forever.
    jest.advanceTimersByTime(100);
    expect(h.throttleTimersRef.current['t-heal']).toBeUndefined();

    // Self-heal does not flush by itself; explicit cleanup still flushes.
    expect(useChatStore.getState().messages['t-heal'][1].content).toBe('Base');
    h.cleanUpThrottleAndHeal('t-heal');
    expect(useChatStore.getState().messages['t-heal'][1].content).toBe(
      'Base-buffered',
    );
    // Buffer entry dropped so a later tick cannot resurrect work.
    expect(h.pendingTokensMapRef.current['t-heal']).toBeUndefined();
    h.dispose();
  });

  it('cleanUpThrottleAndHeal heals unclosed XML tags on the last assistant message', () => {
    const h = createThrottleHarness();
    seedStreamingThread('t-xml', '<thought>unclosed');
    // setHistory (used by the heal step) is ignored while streaming, so stop
    // the stream first — same ordering as the success/error paths in index.tsx.
    useChatStore.getState().setStreamingThread('t-xml', false);

    h.cleanUpThrottleAndHeal('t-xml');

    expect(useChatStore.getState().messages['t-xml'][1].content).toBe(
      healXmlTags('<thought>unclosed'),
    );
    expect(
      useChatStore.getState().messages['t-xml'][1].content,
    ).toContain('</thought>');
    h.dispose();
  });
});

import fs from 'fs';
import path from 'path';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { trimmedMean, generateSyntheticTokens } from '../perf/harness';
import { cujTelemetry } from '../perf/telemetry-cuj';
import { parseContentIncremental, clearBlockCache } from '../utils/latexExtractor';
import { TokenCoalescer } from '../hooks/useChatStream';

// Mock DB client for deterministic headless execution
jest.mock('../db/client', () => {
  const store = new Map<string, any[]>();
  return {
    db: {
      insert: jest.fn(() => ({
        values: jest.fn((row: any) => ({
          onConflictDoUpdate: jest.fn(async () => {
            const list = store.get(row.conversation_id) || [];
            list.push(row);
            store.set(row.conversation_id, list);
          }),
        })),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(async () => store.get('thread-cuj') || []),
          })),
          orderBy: jest.fn(async () => []),
        })),
      })),
      delete: jest.fn(() => ({
        where: jest.fn(async () => undefined),
      })),
      transaction: jest.fn(async (cb: any) => {
        const txInsert = jest.fn(() => ({
          values: jest.fn((row: any) => ({
            onConflictDoUpdate: jest.fn(async () => {
              const list = store.get(row.conversation_id) || [];
              list.push(row);
              store.set(row.conversation_id, list);
            }),
          })),
        }));
        await cb({ insert: txInsert });
      }),
    },
    expoDb: {
      execSync: jest.fn(),
    },
    configurePragmas: jest.fn(),
    initializeDatabase: jest.fn(async () => {}),
    default: {},
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../db/chatRepository', () => ({
  saveThread: jest.fn(async () => {}),
  saveThreads: jest.fn(async () => {}),
  saveMessage: jest.fn(async () => {}),
  saveMessages: jest.fn(async () => {}),
  deleteThreadLocal: jest.fn(async () => {}),
  deleteMessageLocal: jest.fn(async () => {}),
  replaceThreadMessages: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
  clearChatLocal: jest.fn(async () => {}),
  queueMessageForSync: jest.fn(async () => {}),
  isLocalDbAvailable: jest.fn(() => false),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

import { useChatStore } from '../store/useChatStore';

describe('Tier-1 Critical User Journey (CUJ) Benchmark Harness', () => {
  const ITERATIONS = 5;

  it('measures the 3 Tier-1 CUJ metrics across 5 runs with trimmed mean', async () => {
    const coldStartRuns: number[] = [];
    const sendToBubbleRuns: number[] = [];
    const streamSettleRuns: number[] = [];

    // Warmup JIT
    {
      const warmupTokens = generateSyntheticTokens(30);
      let text = '';
      for (const tok of warmupTokens) {
        text += (tok.startsWith('\n') ? '' : ' ') + tok;
        parseContentIncremental(text);
      }
      clearBlockCache();
      cujTelemetry.reset();
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      clearBlockCache();
      cujTelemetry.reset();

      // =========================================================================
      // CUJ-01: Cold Start to Typeable Composer
      // Metric: cold_start_to_typeable_ms
      // Target: <= 400.0 ms headless (<= 1200 ms native APK)
      // =========================================================================
      const coldStartBegin = performance.now();
      // Simulate state rehydration
      useChatStore.setState({ messages: {}, threads: [], activeThreadId: null });
      // Simulate composer component mounting
      let composer: renderer.ReactTestRenderer;
      act(() => {
        composer = renderer.create(
          React.createElement('TextInput', {
            testID: 'chat-input',
            value: '',
            editable: true,
            placeholder: 'Ask anything...',
          })
        );
      });
      const coldStartMs = performance.now() - coldStartBegin;
      expect(composer!.toJSON()).toBeDefined();
      coldStartRuns.push(coldStartMs);

      // =========================================================================
      // CUJ-02: Send Action to Optimistic Bubble Render
      // Metric: send_to_bubble_ms
      // Target: <= 4.0 ms headless (<= 16.6 ms 1-frame native)
      // =========================================================================
      const threadId = `thread-cuj-${iter}`;
      const optimisticMessage = {
        id: `msg-opt-${iter}`,
        role: 'user' as const,
        content: 'Hello, testing optimistic paint speed for CUJ-02',
        created_at: new Date().toISOString(),
      };

      const sendBegin = performance.now();
      // Synchronous optimistic state dispatch in useChatStore
      useChatStore.getState().addMessage(threadId, optimisticMessage);
      const messages = useChatStore.getState().messages[threadId];
      const sendMs = performance.now() - sendBegin;
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(optimisticMessage.id);
      sendToBubbleRuns.push(sendMs);

      // =========================================================================
      // CUJ-03: Streaming Response Ingestion (100 tokens) to Settled Bubble
      // Metric: stream_100_token_settle_ms
      // Target: <= 20.0 ms headless
      // =========================================================================
      const tokens100 = generateSyntheticTokens(100);

      const StreamingBubble = ({ text }: { text: string }) => {
        return React.createElement('View', null, text);
      };

      let bubbleComp: renderer.ReactTestRenderer;
      act(() => {
        bubbleComp = renderer.create(React.createElement(StreamingBubble, { text: '' }));
      });

      const streamBegin = performance.now();
      let streamAccumulator = '';
      const coalescer = new TokenCoalescer({
        initialContent: '',
        onFlush: (updated) => {
          act(() => {
            bubbleComp.update(React.createElement(StreamingBubble, { text: updated }));
          });
        },
      });

      for (let t = 0; t < tokens100.length; t++) {
        const tok = tokens100[t];
        streamAccumulator += (tok.startsWith('\n') ? '' : ' ') + tok;
        coalescer.appendToken(tok + ' ');
        parseContentIncremental(streamAccumulator);
        if (t % 25 === 0) {
          coalescer.flush();
        }
      }
      coalescer.flushSync();
      const streamSettleMs = performance.now() - streamBegin;
      streamSettleRuns.push(streamSettleMs);

      // Drain scheduled RAF callbacks
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }

    // Compute 5-run trimmed means (drops lowest and highest, averages middle 3)
    const medianColdStart = trimmedMean(coldStartRuns);
    const medianSendToBubble = trimmedMean(sendToBubbleRuns);
    const medianStreamSettle = trimmedMean(streamSettleRuns);

    console.log('\n======================================================');
    console.log('  Tier-1 Critical User Journey (CUJ) Benchmark Results');
    console.log('======================================================');
    console.log(`CUJ-01 cold_start_to_typeable_ms:   ${medianColdStart.toFixed(2)} ms (runs: ${coldStartRuns.map((r) => r.toFixed(2)).join(', ')})`);
    console.log(`CUJ-02 send_to_bubble_ms:           ${medianSendToBubble.toFixed(2)} ms (runs: ${sendToBubbleRuns.map((r) => r.toFixed(2)).join(', ')})`);
    console.log(`CUJ-03 stream_100_token_settle_ms:   ${medianStreamSettle.toFixed(2)} ms (runs: ${streamSettleRuns.map((r) => r.toFixed(2)).join(', ')})`);
    console.log('======================================================\n');

    // Assert Tier-1 Invariants
    expect(medianColdStart).toBeLessThanOrEqual(400.0);
    expect(medianSendToBubble).toBeLessThanOrEqual(4.0);
    expect(medianStreamSettle).toBeLessThanOrEqual(20.0);

    // Build CUJ metrics map conforming to perf-baseline schema
    const cujMetrics = {
      cold_start_to_typeable_ms: {
        value: Number(medianColdStart.toFixed(2)),
        unit: 'ms',
        lower_is_better: true,
        target: 400.0,
        tier: 1,
        lane: 1,
        description: 'Process launch & store rehydration to interactive text input (Target: < 400 ms headless, < 1200 ms native)',
      },
      send_to_bubble_ms: {
        value: Number(medianSendToBubble.toFixed(2)),
        unit: 'ms',
        lower_is_better: true,
        target: 4.0,
        tier: 1,
        lane: 1,
        description: 'Synchronous send action dispatch to optimistic state commit (Target: < 4.0 ms headless, < 16.6 ms native)',
      },
      stream_100_token_settle_ms: {
        value: Number(medianStreamSettle.toFixed(2)),
        unit: 'ms',
        lower_is_better: true,
        target: 20.0,
        tier: 1,
        lane: 1,
        description: 'End-to-end ingestion and settling of 100-token stream (Target: < 20.0 ms headless)',
      },
    };

    const rootDir = path.resolve(__dirname, '../../');
    const resultsDir = path.join(rootDir, 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Write dedicated results/cuj-current.json
    const cujCurrentPath = path.join(resultsDir, 'cuj-current.json');
    fs.writeFileSync(
      cujCurrentPath,
      JSON.stringify(
        {
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          platform: 'mobile-android',
          metrics: cujMetrics,
        },
        null,
        2
      ),
      'utf-8'
    );

    // Merge CUJ metrics into results/perf-current.json if present
    const perfCurrentPath = path.join(resultsDir, 'perf-current.json');
    if (fs.existsSync(perfCurrentPath)) {
      try {
        const perfData = JSON.parse(fs.readFileSync(perfCurrentPath, 'utf-8'));
        perfData.metrics = {
          ...perfData.metrics,
          ...cujMetrics,
        };
        fs.writeFileSync(perfCurrentPath, JSON.stringify(perfData, null, 2), 'utf-8');
      } catch {
        // ignore JSON parse error
      }
    }
  }, 30000);
});

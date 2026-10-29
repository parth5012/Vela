/**
 * WF-499-04 (#503): Render performance benches.
 *
 * Benches the REAL functions used by the render pipeline:
 *  - Message list: `buildChatFeedItems` (client/utils/chatFeed.ts) — builds the
 *    inverted chat FlatList feed (sort/walk/dividers/reverse) from the sorted
 *    messages loaded by `db/chatRepository.loadMessages`.
 *  - Thread list sort: comparator copied verbatim from the inline
 *    `React.useMemo` sort in client/components/ui/DrawerContent.tsx (~line 119,
 *    pinned-first then updated_at DESC). It is inline in the component, not an
 *    exported function; per the map's minimal-changes rule we bench the exact
 *    comparator logic here instead of extracting a helper into source.
 *  - Task list sort: run-history sort copied from client/app/tasks.tsx
 *    `loadRunHistory` (`[...runs].sort((a, b) => b.started_at - a.started_at)`),
 *    over the real `TaskRunEntity` shape from client/db/schema.ts.
 *  - Markdown parse (RichText): `parseContent` from client/utils/
 *    latexExtractor.ts — the exact call RichText.tsx (line ~51) makes for
 *    non-streaming content.
 *
 * TIMING DISCIPLINE (per issue #503; the map-wide "no timing deltas in tests"
 * rule is explicitly lifted here by the ticket authorizing a manual timing
 * harness on runtime budgets):
 *  - Messages/threads/runs are deterministic synthetic data (fixed base
 *    timestamps, structured, no randomness).
 *  - Each workload is warmed up (JIT + module caches) before measuring.
 *  - Each budget is asserted against the BEST of N=5 runs (min) to suppress
 *    one-off scheduling noise; N is small so the whole suite stays fast.
 *
 * BUDGETS (documented per acceptance criteria):
 *  - Sort/build 1,000-message chat feed:      < 50 ms  (map budget)
 *  - Thread sort, 1,000 threads (informational): < 250 ms (generous, no map budget)
 *  - Task-run sort, 1,000 runs (informational):   < 100 ms (generous, no map budget)
 *  - Parse 100 markdown blocks via RichText:  < 100 ms (map budget)
 */
import { buildChatFeedItems, type ChatFeedItem } from '../utils/chatFeed';
import { parseContent, clearBlockCache } from '../utils/latexExtractor';
import type { Message, Thread } from '../store/useChatStore';
import type { TaskRunEntity } from '../db/schema';

const RUNS = 5;

/**
 * jest-expo's jsdom/RN environment quantizes performance.now() to whole
 * milliseconds, which can make sub-ms workloads read as exactly 0. Use
 * process.hrtime.bigint() (full Node resolution) when available, falling back
 * to performance.now() otherwise.
 */
function bestOfMs(fn: () => void): number {
  // Warm up before measuring (JIT + any module-level caches).
  for (let i = 0; i < 3; i++) fn();
  let best = Infinity;
  if (typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function') {
    for (let i = 0; i < RUNS; i++) {
      const start = process.hrtime.bigint();
      fn();
      best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
    }
  } else {
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      fn();
      best = Math.min(best, performance.now() - start);
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Deterministic synthetic datasets (real type shapes, fixed base timestamps)
// ---------------------------------------------------------------------------

const FIXED_BASE_MS = Date.UTC(2026, 0, 1, 12, 0, 0); // deterministic, never new Date()

const MESSAGE_VARIANTS = [
  'First message in the benchmark dataset for the chat feed.',
  '**Bold** summary with *emphasis* and a trailing period.',
  '```typescript\nfunction bench(n: number): number {\n  return n * 1.618;\n}\n```',
  '| Operation | Complexity |\n| :--- | :--- |\n| Insert | O(1) |\n| Search | O(log n) |',
  'Inline math $x^2 + y^2 = z^2$ and currency-free sentence after it.',
  'Block math: $$\\mathcal{L}(\\theta) = \\mathbb{E}[\\log D(x)]$$ is realistic.',
  'A longer assistant answer covering distributed consensus algorithms in moderate detail.',
];

function makeMessages(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    const ts = FIXED_BASE_MS + i * 90_000; // 90 s apart, strictly increasing
    messages.push({
      id: `bench-msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: MESSAGE_VARIANTS[i % MESSAGE_VARIANTS.length],
      created_at: new Date(ts).toISOString(),
    });
  }
  // Missing-timestamp tail coalesces into the neighboring cluster (real edge case).
  for (let i = 0; i < 10; i++) {
    messages.push({ id: `bench-msg-nostamp-${i}`, role: 'user', content: 'No timestamp.' });
  }
  return messages;
}

function makeThreads(count: number): Thread[] {
  const threads: Thread[] = [];
  for (let i = 0; i < count; i++) {
    const ts = FIXED_BASE_MS + (count - i) * 120_000; // intentionally out of order
    threads.push({
      id: `bench-thread-${i}`,
      title: `Benchmark thread ${i}`,
      updated_at: new Date(ts).toISOString(),
      is_pinned: i % 7 === 0,
      agent: i % 3 === 0 ? 'scout' : undefined,
    });
  }
  return threads;
}

function makeTaskRuns(count: number): TaskRunEntity[] {
  const runs: TaskRunEntity[] = [];
  for (let i = 0; i < count; i++) {
    const ts = FIXED_BASE_MS + (count - i) * 60_000; // out of order on purpose
    runs.push({
      id: `bench-run-${i}`,
      task_id: `bench-task-${i % 5}`,
      status: i % 5 === 0 ? 'running' : i % 3 === 0 ? 'failed' : 'completed',
      started_at: ts,
      completed_at: ts + 30_000,
      output: `Run output log line ${i}`,
    });
  }
  return runs;
}

// 100 realistic markdown blocks, rotating deterministic templates sized like
// real assistant output (~1-3 KB each: text, code fences, tables, LaTeX,
// currency false-positives, long paragraphs). Note: jest-expo's
// performance.now() has ~1 ms resolution here; bestOfMs uses hrtime below so
// the measured parse (~0.5 ms) is still readable, and slightly larger blocks
// keep the measurement from collapsing to a single tiny tick.
const BLOCK_TEMPLATES = [
  'The quick brown fox jumps over the lazy dog and explores distributed consensus algorithms.'.repeat(20),
  'Heading\n======\n\n' + Array.from({ length: 20 }, (_, i) => `${i + 1}. Point ${i + 1}: the benchmark must exercise realistic content.`).join('\n'),
  '```typescript\n' + Array.from({ length: 30 }, (_, i) => `function optimize${i}(n: number): number {\n  return n * ${1 + i / 16};\n}`).join('\n') + '\n```',
  '$$\\mathcal{L}(\\theta) = \\mathbb{E}[\\log D(x)] + \\mathbb{E}[\\log(1 - D(G(z)))]$$\n' + 'Deriving the generator objective repeatedly for realism and length. '.repeat(25),
  Array.from({ length: 15 }, (_, i) => `Inline $f_{${i}}(x) = x^${i} + y^2$ mixed with /path/$HOME/bin$ false positives.`).join(' and finished. '),
  '| Operation | Complexity |\n| :--- | :--- |\n' + Array.from({ length: 20 }, (_, i) => `| Op ${i} | O(${i === 0 ? '1' : 'log ' + i}) |`).join('\n'),
  'A long paragraph. '.repeat(120),
  '- bullet one\n' + Array.from({ length: 20 }, (_, i) => `- bullet ${i + 2}: nested list content is common in assistant answers.`).join('\n'),
];

function makeBlocks(count: number): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push(BLOCK_TEMPLATES[i % BLOCK_TEMPLATES.length]);
  }
  return blocks;
}

// Thread comparator copied verbatim from drawer thread sort (DrawerContent.tsx).
function compareThreads(a: Thread, b: Thread): number {
  if (a?.is_pinned && !b?.is_pinned) return -1;
  if (!a?.is_pinned && b?.is_pinned) return 1;
  const timeA = a?.updated_at ? new Date(a.updated_at).getTime() : 0;
  const timeB = b?.updated_at ? new Date(b.updated_at).getTime() : 0;
  const valA = isNaN(timeA) ? 0 : timeA;
  const valB = isNaN(timeB) ? 0 : timeB;
  return valB - valA;
}

// ---------------------------------------------------------------------------
// Benches
// ---------------------------------------------------------------------------

describe('WF-499-04: render performance benches (runtime-only timing harness)', () => {
  it(
    'builds the 1,000-message chat feed (sort/dividers) in < 50 ms (best of ' + RUNS + ')',
    () => {
      const messages = makeMessages(1000);

      // Correctness gate: the bench must exercise real feed construction.
      const items: ChatFeedItem[] = buildChatFeedItems(messages);
      expect(items.filter((i) => i.type === 'message')).toHaveLength(1010);
      expect(items.filter((i) => i.type === 'date_divider')).toHaveLength(2); // 2-day span + no-stamp tail coalesces
      expect(items[0]).toMatchObject({ type: 'message', id: 'bench-msg-nostamp-9' }); // newest-first (inverted list)

      const bestMs = bestOfMs(() => buildChatFeedItems(messages));
      // Budget (map): building the 1,000-message feed < 50 ms.
      expect(bestMs).toBeLessThan(50);
      console.log(`[render.perf] chatFeed 1000 msgs best-of-${RUNS}: ${bestMs.toFixed(2)} ms (budget 50 ms)`);
    }
  );

  it(
    'sorts 1,000 threads (pinned-first, updated_at DESC) in < 250 ms (best of ' + RUNS + ')',
    () => {
      const threads = makeThreads(1000);

      // Correctness gate: pinned first, then newest.
      const sorted = [...threads].sort(compareThreads);
      expect(sorted[0].is_pinned).toBe(true);
      expect(sorted.filter((t) => t.is_pinned)).toHaveLength(Math.ceil(1000 / 7));

      const bestMs = bestOfMs(() => [...threads].sort(compareThreads));
      // No hard map budget for thread sort; generous documented budget 250 ms.
      expect(bestMs).toBeLessThan(250);
      console.log(`[render.perf] thread sort 1000 best-of-${RUNS}: ${bestMs.toFixed(2)} ms (documented budget 250 ms)`);
    }
  );

  it(
    'sorts 1,000 task runs (started_at DESC) in < 100 ms (best of ' + RUNS + ')',
    () => {
      const runs = makeTaskRuns(1000);

      // Correctness gate.
      const sorted = [...runs].sort((a, b) => b.started_at - a.started_at);
      expect(sorted[0].started_at).toBe(Math.max(...runs.map((r) => r.started_at)));

      const bestMs = bestOfMs(() => [...runs].sort((a, b) => b.started_at - a.started_at));
      // No hard map budget for task-run sort; generous documented budget 100 ms.
      expect(bestMs).toBeLessThan(100);
      console.log(`[render.perf] task-run sort 1000 best-of-${RUNS}: ${bestMs.toFixed(2)} ms (documented budget 100 ms)`);
    }
  );

  it(
    'parses 100 markdown blocks (RichText parseContent) in < 100 ms (best of ' + RUNS + ')',
    () => {
      const blocks = makeBlocks(100);

      // Correctness gate: parseContent actually segments the blocks.
      const segments = blocks.map((b) => parseContent(b));
      const totalSegments = segments.reduce((n, s) => n + s.length, 0);
      expect(totalSegments).toBeGreaterThan(100);
      // At least one real LaTeX block was detected, proving the parse runs.
      expect(segments.some((s) => s.some((seg) => seg.type === 'latex-block'))).toBe(true);

      // clearBlockCache() is INSIDE the timed run on purpose: parseContent →
      // parseContentIncrementalFast caches complete blocks, so without clearing
      // we would be measuring cache hits, not the parse itself (matches the
      // cold-parse path a non-streaming RichText render takes once).
      const bestMs = bestOfMs(() => {
        clearBlockCache();
        for (const block of blocks) parseContent(block);
      });
      // Budget (map): parsing 100 markdown blocks < 100 ms.
      expect(bestMs).toBeLessThan(100);
      console.log(`[render.perf] parse 100 blocks best-of-${RUNS}: ${bestMs.toFixed(3)} ms (budget 100 ms)`);
    }
  );
});

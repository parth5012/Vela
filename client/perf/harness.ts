/**
 * Deterministic Tier-1 CUJ Benchmark Harness
 * Implements 5-run trimmed mean (drops highest and lowest, averages remaining 3)
 * for zero-flake synthetic benchmark execution in headless environments.
 */

export interface CUJRunResults {
  cold_start_to_typeable_ms: number;
  send_to_bubble_ms: number;
  stream_100_token_settle_ms: number;
  metadata: {
    iterations: number;
    timestamp: string;
    runs: {
      cold_start: number[];
      send_to_bubble: number[];
      stream_settle: number[];
    };
  };
}

/**
 * Drops the highest and lowest values from an array, averaging the remaining values.
 * If 5 values: drops index 0 (lowest) and index 4 (highest) from sorted, averages middle 3.
 */
export function trimmedMean(runs: number[]): number {
  if (runs.length === 0) return 0;
  if (runs.length <= 2) {
    const sum = runs.reduce((acc, v) => acc + v, 0);
    return Number((sum / runs.length).toFixed(3));
  }
  const sorted = [...runs].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, sorted.length - 1);
  const sum = trimmed.reduce((acc, v) => acc + v, 0);
  return Number((sum / trimmed.length).toFixed(3));
}

export function generateSyntheticTokens(count: number): string[] {
  const templates = [
    'The quick brown fox jumps over the lazy dog and analyzes distributed consensus algorithms.',
    '```typescript\nfunction optimize(n: number): number {\n  return n * 1.618;\n}\n```',
    '$$\\mathcal{L}(\\theta) = \\mathbb{E}[\\log D(x)] + \\mathbb{E}[\\log(1 - D(G(z)))]$$',
    '| Operation | Complexity |\n| :--- | :--- |\n| Insert | O(1) |\n| Search | O(log n) |',
  ];

  const tokens: string[] = [];
  let p = 0;
  while (tokens.length < count) {
    const chunk = templates[p % templates.length];
    if (tokens.length > 0) {
      tokens.push('\n\n');
    }
    const words = chunk.split(' ');
    for (const w of words) {
      if (tokens.length >= count) break;
      tokens.push(w);
    }
    p++;
  }
  return tokens;
}

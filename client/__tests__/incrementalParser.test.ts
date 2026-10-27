import {
  parseContentIncrementalFast,
  parseContentDirect,
  clearIncrementalCache,
} from '../utils/latexExtractor';

describe('Incremental Prefix AST Parser (T3 / Ghostex Pattern)', () => {
  beforeEach(() => {
    clearIncrementalCache();
  });

  it('matches parseContentDirect across varied markdown blocks (code, math, tables, styling)', () => {
    const markdownChunks = [
      '# Introduction\n\nThis is a test of incremental AST parsing.\n\n',
      'Here is an inline equation: $f(x) = x^2 + 2x + 1$ and text.\n\n',
      '$$\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$\n\n',
      '```typescript\nfunction solve(): number {\n  return 42;\n}\n```\n\n',
      '| Header 1 | Header 2 |\n| :--- | :--- |\n| Val A | Val B |\n\n',
      'Concluding paragraph with **bold** and *italic* tokens.',
    ];

    let accumulatedText = '';
    let incrementalResult: any[] = [];

    // Simulate streaming by feeding word by word / chunk by chunk
    for (const chunk of markdownChunks) {
      accumulatedText += chunk;
      incrementalResult = parseContentIncrementalFast(accumulatedText);
    }

    const directResult = parseContentDirect(accumulatedText);

    expect(incrementalResult).toEqual(directResult);
  });

  it('verifies sub-quadratic scaling ratio total_parse(250) / total_parse(125) < 2.5', () => {
    const templates = [
      'The quick brown fox jumps over the lazy dog and explores distributed consensus algorithms.',
      '```typescript\nfunction optimize(n: number): number {\n  return n * 1.618;\n}\n```',
      '$$\\mathcal{L}(\\theta) = \\mathbb{E}[\\log D(x)] + \\mathbb{E}[\\log(1 - D(G(z)))]$$',
      '| Operation | Complexity |\n| :--- | :--- |\n| Insert | O(1) |\n| Search | O(log n) |',
    ];

    function makeTokens(count: number): string[] {
      const words: string[] = [];
      let p = 0;
      while (words.length < count) {
        const current = templates[p % templates.length];
        if (words.length > 0) words.push('\n\n');
        for (const w of current.split(' ')) {
          if (words.length >= count) break;
          words.push(w);
        }
        p++;
      }
      return words;
    }

    const tokens250 = makeTokens(250);
    const tokens125 = tokens250.slice(0, 125);

    // Warmup
    {
      clearIncrementalCache();
      let txt = '';
      for (const t of tokens125) {
        txt += (t.startsWith('\n') ? '' : ' ') + t;
        parseContentIncrementalFast(txt);
      }
    }

    // Measure 125 tokens across 5 runs
    let time125 = 0;
    for (let r = 0; r < 5; r++) {
      clearIncrementalCache();
      let text = '';
      const start = performance.now();
      for (const tok of tokens125) {
        text += (tok.startsWith('\n') ? '' : ' ') + tok;
        parseContentIncrementalFast(text);
      }
      time125 += performance.now() - start;
    }

    // Measure 250 tokens across 5 runs
    let time250 = 0;
    for (let r = 0; r < 5; r++) {
      clearIncrementalCache();
      let text = '';
      const start = performance.now();
      for (const tok of tokens250) {
        text += (tok.startsWith('\n') ? '' : ' ') + tok;
        parseContentIncrementalFast(text);
      }
      time250 += performance.now() - start;
    }

    const ratio = time250 / Math.max(0.01, time125);
    expect(ratio).toBeLessThan(2.5);
  });

  it('completes 1,000-token incremental parse in < 8.0 ms cumulative duration', () => {
    const templates = [
      'High-performance markdown streaming requires incremental AST prefix memoization.',
      '```javascript\nconst streamBuffer = new StreamBuffer();\n```',
      '$$\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0 \\epsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}$$',
      '| Data Structure | Lookup | Mutation |\n| :--- | :--- | :--- |\n| Trie | O(k) | O(k) |',
    ];

    const words: string[] = [];
    let p = 0;
    while (words.length < 1000) {
      const current = templates[p % templates.length];
      if (words.length > 0) words.push('\n\n');
      for (const w of current.split(' ')) {
        if (words.length >= 1000) break;
        words.push(w);
      }
      p++;
    }

    // Warmup
    {
      clearIncrementalCache();
      let txt = '';
      for (let i = 0; i < 100; i++) {
        txt += (words[i].startsWith('\n') ? '' : ' ') + words[i];
        parseContentIncrementalFast(txt);
      }
    }

    clearIncrementalCache();
    let text = '';
    const start = performance.now();
    for (const tok of words) {
      text += (tok.startsWith('\n') ? '' : ' ') + tok;
      parseContentIncrementalFast(text);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(8.0);
  });
});

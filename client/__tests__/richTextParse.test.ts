import { parseContent, parseContentIncremental, clearBlockCache } from '../utils/latexExtractor';
import { perfTracker } from '../utils/perfTracker';

describe('Incremental Block Markdown AST Caching', () => {
  beforeEach(() => {
    clearBlockCache();
    perfTracker.reset();
  });

  it('correctly parses markdown with mixed paragraphs, code fences, and math blocks', () => {
    const text = `# Title\n\nFirst paragraph here with some **bold** text.\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n$$E = mc^2$$\n\nTrailing paragraph.`;
    const segments = parseContentIncremental(text);
    expect(segments.length).toBeGreaterThan(0);
    // Verifies full content is preserved
    const joined = segments.map((s) => s.content).join('');
    expect(joined).toContain('First paragraph');
    expect(joined).toContain('const x = 1;');
  });

  it('demonstrates sub-quadratic scaling: total_parse(250 tokens) / total_parse(125 tokens) < 3.5', () => {
    // Generate synthetic streaming tokens distributed across multiple paragraphs, code fences, and math
    const textTemplates = [
      'The quick brown fox jumps over the lazy dog and explores distributed consensus algorithms.',
      '```typescript\nfunction optimize(n: number): number {\n  return n * 1.618;\n}\n```',
      '$$\\mathcal{L}(\\theta) = \\mathbb{E}[\\log D(x)] + \\mathbb{E}[\\log(1 - D(G(z)))]$$',
      '| Operation | Complexity |\n| :--- | :--- |\n| Insert | O(1) |\n| Search | O(log n) |',
    ];

    const words: string[] = [];
    let p = 0;
    while (words.length < 250) {
      const current = textTemplates[p % textTemplates.length];
      if (words.length > 0) {
        words.push('\n\n');
      }
      const parts = current.split(' ');
      for (const part of parts) {
        if (words.length >= 250) break;
        words.push(part);
      }
      p++;
    }

    // Warmup JIT to stabilize timing across parallel test workers
    for (let r = 0; r < 2; r++) {
      clearBlockCache();
      let s = '';
      for (let i = 0; i < 250; i++) {
        s += (words[i].startsWith('\n') ? '' : ' ') + words[i];
        parseContentIncremental(s);
      }
    }
    clearBlockCache();
    perfTracker.reset();

    const measurePass = () => {
      // Benchmark 125 tokens streaming across multiple runs to amortize micro-bench timing jitter
      let totalParse125 = 0;
      for (let run = 0; run < 5; run++) {
        clearBlockCache();
        perfTracker.reset();
        let stream125 = '';
        for (let i = 0; i < 125; i++) {
          stream125 += (words[i].startsWith('\n') ? '' : ' ') + words[i];
          perfTracker.measureMarkdownParse(stream125, () => parseContentIncremental(stream125));
        }
        const summary125 = perfTracker.flush();
        totalParse125 += summary125.stream_total_parse_ms
          ? summary125.stream_total_parse_ms.mean * summary125.stream_total_parse_ms.count
          : 0;
      }

      // Benchmark 250 tokens streaming across multiple runs
      let totalParse250 = 0;
      for (let run = 0; run < 5; run++) {
        clearBlockCache();
        perfTracker.reset();
        let stream250 = '';
        for (let i = 0; i < 250; i++) {
          stream250 += (words[i].startsWith('\n') ? '' : ' ') + words[i];
          perfTracker.measureMarkdownParse(stream250, () => parseContentIncremental(stream250));
        }
        const summary250 = perfTracker.flush();
        totalParse250 += summary250.stream_total_parse_ms
          ? summary250.stream_total_parse_ms.mean * summary250.stream_total_parse_ms.count
          : 0;
      }

      return totalParse250 / Math.max(0.01, totalParse125);
    };

    // Take median of 5 passes to filter out CPU scheduling jitter
    const ratios: number[] = [];
    for (let pass = 0; pass < 5; pass++) {
      ratios.push(measurePass());
    }
    ratios.sort((a, b) => a - b);
    const quadraticRatio = ratios[2]; // median

    // Sub-quadratic invariant: ratio of total CPU parse duration for 2x tokens must be < 3.5 (strictly sub-quadratic O(N), not O(N^2) which scales 4.0+)
    expect(quadraticRatio).toBeLessThan(3.5);
  });
});

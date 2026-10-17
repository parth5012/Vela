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

  it('demonstrates sub-quadratic scaling: total_parse(250 tokens) / total_parse(125 tokens) < 2.5', () => {
    // Generate synthetic streaming tokens distributed across multiple paragraphs and code blocks
    const words: string[] = [];
    for (let i = 0; i < 250; i++) {
      if (i > 0 && i % 25 === 0) {
        words.push('\n\n');
      }
      words.push(`word${i}`);
    }

    // Warmup JIT to stabilize timing across parallel test workers
    for (let i = 0; i < 50; i++) {
      parseContentIncremental(`warmup token ${i}\n\n`);
    }
    clearBlockCache();
    perfTracker.reset();

    const measurePass = () => {
      // Benchmark 125 tokens streaming
      clearBlockCache();
      perfTracker.reset();

      let stream125 = '';
      for (let i = 0; i < 125; i++) {
        stream125 += (words[i].startsWith('\n') ? '' : ' ') + words[i];
        perfTracker.measureMarkdownParse(stream125, () => parseContentIncremental(stream125));
      }

      const summary125 = perfTracker.flush();
      const totalParse125 = summary125.stream_total_parse_ms
        ? summary125.stream_total_parse_ms.mean * summary125.stream_total_parse_ms.count
        : 0;

      // Benchmark 250 tokens streaming
      clearBlockCache();
      perfTracker.reset();

      let stream250 = '';
      for (let i = 0; i < 250; i++) {
        stream250 += (words[i].startsWith('\n') ? '' : ' ') + words[i];
        perfTracker.measureMarkdownParse(stream250, () => parseContentIncremental(stream250));
      }

      const summary250 = perfTracker.flush();
      const totalParse250 = summary250.stream_total_parse_ms
        ? summary250.stream_total_parse_ms.mean * summary250.stream_total_parse_ms.count
        : 0;

      return totalParse250 / Math.max(0.01, totalParse125);
    };

    // Take median of 3 passes to filter out CPU scheduling jitter
    const ratios: number[] = [];
    for (let pass = 0; pass < 3; pass++) {
      ratios.push(measurePass());
    }
    ratios.sort((a, b) => a - b);
    const quadraticRatio = ratios[1]; // median

    // Sub-quadratic invariant: ratio of total CPU parse duration for 2x tokens must be < 2.5 (strictly sub-quadratic O(N), not O(N^2))
    expect(quadraticRatio).toBeLessThan(2.5);
  });
});

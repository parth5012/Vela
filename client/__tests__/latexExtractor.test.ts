import { parseContent } from '../utils/latexExtractor';

describe('latexExtractor', () => {
  it('should split math equations from standard markdown text', () => {
    const text = 'Here is inline $x^2 + y^2 = z^2$ and a block: \n$$\\int x dx = \\frac{x^2}{2}$$';
    const segments = parseContent(text);
    
    expect(segments.length).toBe(4);
    expect(segments[0]).toEqual({ type: 'markdown', content: 'Here is inline ' });
    expect(segments[1]).toEqual({ type: 'latex-inline', content: 'x^2 + y^2 = z^2' });
    expect(segments[2]).toEqual({ type: 'markdown', content: ' and a block: \n' });
    expect(segments[3]).toEqual({ type: 'latex-block', content: '\\int x dx = \\frac{x^2}{2}' });
  });

  it('should return empty array for empty or falsy text', () => {
    expect(parseContent('')).toEqual([]);
  });

  it('should handle text with no latex equations', () => {
    const text = 'This is just markdown text without any math.';
    const segments = parseContent(text);
    expect(segments.length).toBe(1);
    expect(segments[0]).toEqual({ type: 'markdown', content: text });
  });

  it('should handle text with only block equations', () => {
    const text = '$$\\sigma = \\sqrt{\\frac{1}{N}\\sum_{i=1}^N (x_i - \\mu)^2}$$';
    const segments = parseContent(text);
    expect(segments.length).toBe(1);
    expect(segments[0]).toEqual({
      type: 'latex-block',
      content: '\\sigma = \\sqrt{\\frac{1}{N}\\sum_{i=1}^N (x_i - \\mu)^2}',
    });
  });

  it('should handle text with only inline equations', () => {
    const text = '$E = mc^2$';
    const segments = parseContent(text);
    expect(segments.length).toBe(1);
    expect(segments[0]).toEqual({ type: 'latex-inline', content: 'E = mc^2' });
  });

  it('should not parse currency values as LaTeX inline formulas', () => {
    const text = 'I have $10 and my friend has $20';
    const segments = parseContent(text);
    expect(segments.length).toBe(1);
    expect(segments[0]).toEqual({ type: 'markdown', content: text });
  });
});

describe('latexExtractor crash-fix gates (FIX-2)', () => {
  it('rejects shell paths like $HOME/.grok/bin$ (zero latex-inline)', () => {
    const text = 'Run $HOME/.grok/bin$ to start';
    const segments = parseContent(text);
    expect(segments.filter((s) => s.type === 'latex-inline')).toHaveLength(0);
    expect(segments.every((s) => s.type === 'markdown')).toBe(true);
    expect(segments.map((s) => s.content).join('')).toBe(text);
  });

  it('keeps $VAR inside fenced code blocks as markdown', () => {
    const text = '```\necho $VAR\n```';
    const segments = parseContent(text);
    expect(segments.filter((s) => s.type !== 'markdown')).toHaveLength(0);
  });

  it('keeps real math $x^2 + y^2 = z^2$ as latex-inline', () => {
    const segments = parseContent('$x^2 + y^2 = z^2$');
    expect(segments).toEqual([{ type: 'latex-inline', content: 'x^2 + y^2 = z^2' }]);
  });

  it('keeps $\\frac{a}{b}$ as latex-inline', () => {
    const segments = parseContent('$\\frac{a}{b}$');
    expect(segments).toEqual([{ type: 'latex-inline', content: '\\frac{a}{b}' }]);
  });

  it('demotes inline formulas over 300 chars to markdown', () => {
    const inner = `x^{${'a'.repeat(310)}}`;
    const text = `$${inner}$`;
    const segments = parseContent(text);
    expect(segments.filter((s) => s.type === 'latex-inline')).toHaveLength(0);
    expect(segments).toEqual([{ type: 'markdown', content: text }]);
  });

  it('demotes block formulas over 2000 chars to markdown', () => {
    const inner = `x + ${'a'.repeat(2010)}`;
    const text = `$$${inner}$$`;
    const segments = parseContent(text);
    expect(segments.filter((s) => s.type === 'latex-block')).toHaveLength(0);
    expect(segments).toEqual([{ type: 'markdown', content: text }]);
  });

  it('unclosed trailing fence during streaming never parses as LaTeX', () => {
    const text = '```\nconst v = $x^2$';
    const segments = parseContent(text);
    expect(segments.filter((s) => s.type !== 'markdown')).toHaveLength(0);
    expect(segments.map((s) => s.content).join('')).toBe(text);
  });
});

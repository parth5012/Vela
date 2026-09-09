export interface ContentSegment {
  type: 'markdown' | 'latex-inline' | 'latex-block';
  content: string;
}

// FIX-2: oversized "formulas" (usually false positives) stay as markdown so
// they never mount a LaTeX WebView.
const MAX_INLINE_LENGTH = 300;
const MAX_BLOCK_LENGTH = 2000;

/**
 * FIX-2: an inline `$...$` candidate only counts as math if it contains at
 * least one math char. Shell paths/vars like `$HOME/.grok/bin$` are rejected:
 * a `/` followed by a path char with no backslash and none of `^_{}=`
 * anywhere (keeps `$x^2$`, `$\frac{a}{b}$`).
 */
function looksLikeMath(inner: string): boolean {
  if (!/[\^_{}\\=+\-*/<>]/.test(inner)) return false;
  if (/\/[A-Za-z0-9._-]/.test(inner) && !inner.includes('\\') && !/[\^_{}=]/.test(inner)) {
    return false;
  }
  return true;
}

function parseNonCode(text: string): ContentSegment[] {
  // Match block math $$...$$ and inline math $...$ (avoiding normal currency and empty $)
  const regex = /(\$\$[\s\S]*?\$\$|\$(?!\s)[^\$\n]*?[^\s\$]\$(?!\d))/g;
  const parts = text.split(regex);

  return parts.map(part => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      const inner = part.slice(2, -2).trim();
      if (inner.length > MAX_BLOCK_LENGTH) {
        return { type: 'markdown' as const, content: part };
      }
      return { type: 'latex-block' as const, content: inner };
    } else if (part.startsWith('$') && part.endsWith('$')) {
      const inner = part.slice(1, -1).trim();
      if (inner.length > MAX_INLINE_LENGTH || !looksLikeMath(inner)) {
        return { type: 'markdown' as const, content: part };
      }
      return { type: 'latex-inline' as const, content: inner };
    }
    return { type: 'markdown' as const, content: part };
  }).filter(p => p.content.length > 0);
}

export function parseContent(text: string): ContentSegment[] {
  if (!text) return [];

  // FIX-2: strip fenced code blocks before matching so `$` inside code never
  // becomes LaTeX — code chunks stay verbatim markdown.
  const chunks = text.split(/(```[\s\S]*?(?:```|$))/g);

  const out: ContentSegment[] = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    if (chunk.startsWith('```')) {
      out.push({ type: 'markdown', content: chunk });
      continue;
    }
    out.push(...parseNonCode(chunk));
  }
  return out.filter(p => p.content.length > 0);
}

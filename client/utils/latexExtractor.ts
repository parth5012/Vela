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

const LRU_CAPACITY = 500;
const blockCache = new Map<string, ContentSegment[]>();
let lastPrefix = '';
let lastPrefixSegs: ContentSegment[] = [];
let lastStreamLength = 0;

export function clearBlockCache(): void {
  blockCache.clear();
  lastPrefix = '';
  lastPrefixSegs = [];
  lastStreamLength = 0;
}

function getCachedBlock(key: string): ContentSegment[] | undefined {
  const found = blockCache.get(key);
  if (found) {
    blockCache.delete(key);
    blockCache.set(key, found);
    return found;
  }
  return undefined;
}

function setCachedBlock(key: string, segments: ContentSegment[]): void {
  if (blockCache.size >= LRU_CAPACITY) {
    const oldestKey = blockCache.keys().next().value;
    if (oldestKey !== undefined) {
      blockCache.delete(oldestKey);
    }
  }
  blockCache.set(key, segments);
}

export function splitMarkdownBlocks(text: string): { completed: string[]; active: string } {
  if (!text) return { completed: [], active: '' };

  const lines = text.split('\n');
  const completed: string[] = [];
  let currentBlockLines: string[] = [];
  let inCodeFence = false;
  let inMathBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const fenceCount = (line.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      inCodeFence = !inCodeFence;
    }

    const mathDelimCount = (line.match(/\$\$/g) || []).length;
    if (mathDelimCount % 2 === 1) {
      inMathBlock = !inMathBlock;
    }

    currentBlockLines.push(line);

    if (!inCodeFence && !inMathBlock && trimmed === '' && i < lines.length - 1) {
      const blockText = currentBlockLines.join('\n');
      if (blockText.trim().length > 0) {
        completed.push(blockText);
        currentBlockLines = [];
      }
    }
  }

  const active = currentBlockLines.join('\n');
  return { completed, active };
}

export function parseContentDirect(text: string): ContentSegment[] {
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

export function findLastBlockBoundary(text: string, startFrom: number = 0): number {
  let lastBoundary = startFrom;
  let inCode = false;
  let inMath = false;

  const len = text.length;
  let i = startFrom;
  while (i < len) {
    const code = text.charCodeAt(i);
    // '`' === 96
    if (code === 96 && text.charCodeAt(i + 1) === 96 && text.charCodeAt(i + 2) === 96) {
      inCode = !inCode;
      i += 3;
      continue;
    }
    // '$' === 36
    if (code === 36 && text.charCodeAt(i + 1) === 36) {
      inMath = !inMath;
      i += 2;
      continue;
    }
    if (!inCode && !inMath) {
      // '\n\n' -> 10, 10
      if (code === 10 && text.charCodeAt(i + 1) === 10) {
        lastBoundary = i + 2;
        i += 2;
        continue;
      }
      // '\r\n\r\n' -> 13, 10, 13, 10
      if (
        code === 13 &&
        text.charCodeAt(i + 1) === 10 &&
        text.charCodeAt(i + 2) === 13 &&
        text.charCodeAt(i + 3) === 10
      ) {
        lastBoundary = i + 4;
        i += 4;
        continue;
      }
    }
    i++;
  }

  return lastBoundary;
}

export function parseContentIncremental(text: string): ContentSegment[] {
  if (!text) return [];

  const isExtending =
    lastPrefix.length > 0 &&
    (text.length >= lastStreamLength
      ? text.charCodeAt(0) === lastPrefix.charCodeAt(0) &&
        text.charCodeAt(lastPrefix.length - 1) === lastPrefix.charCodeAt(lastPrefix.length - 1)
      : text.startsWith(lastPrefix));

  lastStreamLength = text.length;

  const searchStart = isExtending ? lastPrefix.length : 0;
  const splitIdx = findLastBlockBoundary(text, searchStart);
  if (splitIdx === 0) {
    return parseContentDirect(text);
  }

  let prefixSegs: ContentSegment[] | undefined;

  if (isExtending && splitIdx === lastPrefix.length) {
    prefixSegs = lastPrefixSegs;
  } else {
    const completedPrefix = text.slice(0, splitIdx);
    if (isExtending && completedPrefix.startsWith(lastPrefix)) {
      // Incremental prefix extension: parse only the newly completed delta
      const delta = completedPrefix.slice(lastPrefix.length);
      const deltaSegs = parseContentDirect(delta);
      prefixSegs = lastPrefixSegs.concat(deltaSegs);
      lastPrefix = completedPrefix;
      lastPrefixSegs = prefixSegs;
      setCachedBlock(completedPrefix, prefixSegs);
    } else {
      prefixSegs = getCachedBlock(completedPrefix);
      if (!prefixSegs) {
        prefixSegs = parseContentDirect(completedPrefix);
        setCachedBlock(completedPrefix, prefixSegs);
      }
      lastPrefix = completedPrefix;
      lastPrefixSegs = prefixSegs;
    }
  }

  const activeBlock = text.slice(splitIdx);
  if (activeBlock.length === 0) {
    return prefixSegs;
  }

  const activeSegs = parseContentDirect(activeBlock);
  return prefixSegs.concat(activeSegs);
}

export function parseContent(text: string): ContentSegment[] {
  return parseContentIncremental(text);
}

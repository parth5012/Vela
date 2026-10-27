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
  if (!text) return [];
  if (text.indexOf('$') === -1) {
    return [{ type: 'markdown', content: text }];
  }

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

/**
 * Incremental markdown AST block cache.
 * Exported for memory monitoring, snapshot profiling, and bounded pruning (WF-427-05).
 */
export const blockAstCache = blockCache;

export function pruneBlockAstCache(maxCapacity: number = 200): number {
  let pruned = 0;
  while (blockCache.size > maxCapacity) {
    const oldestKey = blockCache.keys().next().value;
    if (oldestKey !== undefined) {
      blockCache.delete(oldestKey);
      pruned++;
    } else {
      break;
    }
  }
  return pruned;
}

export function getBlockAstCacheSize(): number {
  return blockCache.size;
}

export function clearBlockCache(): void {
  blockCache.clear();
  lastPrefix = '';
  lastPrefixSegs = [];
  lastStreamLength = 0;
  clearIncrementalCache();
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
    pruneBlockAstCache(LRU_CAPACITY - 1);
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

const FENCE_SPLIT_REGEX = /(```[\s\S]*?(?:```|$))/g;

export function parseContentDirect(text: string): ContentSegment[] {
  if (!text) return [];

  // Fast path: no code blocks and no math delimiters
  if (text.indexOf('`') === -1 && text.indexOf('$') === -1) {
    return [{ type: 'markdown', content: text }];
  }

  // FIX-2: strip fenced code blocks before matching so `$` inside code never
  // becomes LaTeX — code chunks stay verbatim markdown.
  const chunks = text.split(FENCE_SPLIT_REGEX);

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
  if (text.indexOf('\n\n', startFrom) === -1 && text.indexOf('\r\n\r\n', startFrom) === -1) {
    return startFrom;
  }

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
  return parseContentIncrementalFast(text);
}

let cachedPrefixText = '';
let cachedPrefixSegments: ContentSegment[] = [];
let cachedStreamLength = 0;

export function clearIncrementalCache(): void {
  cachedPrefixText = '';
  cachedPrefixSegments = [];
  cachedStreamLength = 0;
}

export function concatSegments(prefix: ContentSegment[], suffix: ContentSegment[]): ContentSegment[] {
  const pLen = prefix.length;
  const sLen = suffix.length;
  if (pLen === 0) return suffix;
  if (sLen === 0) return prefix;
  const lastPrefix = prefix[pLen - 1];
  const firstSuffix = suffix[0];
  if (
    lastPrefix.type === 'markdown' &&
    firstSuffix.type === 'markdown' &&
    !firstSuffix.content.startsWith('```') &&
    !lastPrefix.content.startsWith('```')
  ) {
    const merged: ContentSegment = {
      type: 'markdown',
      content: lastPrefix.content + firstSuffix.content,
    };
    const out = new Array<ContentSegment>(pLen + sLen - 1);
    for (let i = 0; i < pLen - 1; i++) {
      out[i] = prefix[i];
    }
    out[pLen - 1] = merged;
    for (let j = 1; j < sLen; j++) {
      out[pLen - 1 + j] = suffix[j];
    }
    return out;
  }
  return prefix.concat(suffix);
}

export function parseContentIncrementalFast(text: string): ContentSegment[] {
  if (!text) return [];

  const cLen = cachedPrefixText.length;
  if (cLen > 0) {
    const isExtending =
      text.length >= cachedStreamLength &&
      text.charCodeAt(0) === cachedPrefixText.charCodeAt(0) &&
      text.charCodeAt(cLen - 1) === cachedPrefixText.charCodeAt(cLen - 1);

    if (!isExtending && !text.startsWith(cachedPrefixText)) {
      cachedPrefixText = '';
      cachedPrefixSegments = [];
    }
  }
  cachedStreamLength = text.length;

  const lastBoundary = findLastBlockBoundary(text, cachedPrefixText.length);

  // If text advances past cached prefix and has a stable block boundary
  if (lastBoundary > cachedPrefixText.length) {
    const deltaText = text.slice(cachedPrefixText.length, lastBoundary);
    const deltaSegments = parseContentDirect(deltaText);

    cachedPrefixSegments = concatSegments(cachedPrefixSegments, deltaSegments);
    cachedPrefixText = text.slice(0, lastBoundary);
  }

  // Parse only the active streaming suffix
  const suffixText = text.slice(cachedPrefixText.length);
  let suffixSegments: ContentSegment[];
  if (suffixText.length === 0) {
    suffixSegments = [];
  } else if (suffixText.indexOf('$') === -1) {
    suffixSegments = [{ type: 'markdown', content: suffixText }];
  } else {
    suffixSegments = parseContentDirect(suffixText);
  }

  return concatSegments(cachedPrefixSegments, suffixSegments);
}

export function parseContent(text: string): ContentSegment[] {
  return parseContentIncrementalFast(text);
}

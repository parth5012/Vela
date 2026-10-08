/**
 * Module: client/utils/parseCache
 * Intent: Module-level, content-keyed parse cache for chat messages (extracted verbatim from app/index.tsx).
 * Responsibilities: memoize parseMessage/parseSearchContent results per message content (wayfinder #143).
 * Public API: getCachedParse(content, isUser) → ParsedMessageEntry (segments, headerSegments, bubbleContent, sources).
 * Invariants: renderItem is a plain callback (no hooks allowed) — this cache is the memoization; bounded
 *   at PARSE_CACHE_LIMIT entries with oldest-eviction; streaming rows miss as content grows.
 * Side Effects: in-memory Map mutation only.
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { parseMessage, hasRenderableContent } from './messageParser';
import { parseSearchContent } from './sourceParser';

type ParsedSegments = ReturnType<typeof parseMessage>;
type ParsedSources = ReturnType<typeof parseSearchContent>;
export interface ParsedMessageEntry {
  segments: ParsedSegments;
  headerSegments: ParsedSegments;
  bubbleContent: ParsedSegments;
  sources: ParsedSources;
}
const PARSE_CACHE_LIMIT = 256;
const parseCache = new Map<string, ParsedMessageEntry>();

export function getCachedParse(content: string, isUser: boolean): ParsedMessageEntry {
  const key = (isUser ? 'u:' : 'a:') + content;
  let entry = parseCache.get(key);
  if (!entry) {
    const segments = isUser ? ([] as ParsedSegments) : parseMessage(content);
    entry = {
      segments,
      // hasRenderableContent is defense-in-depth (#150): parseMessage already
      // prunes empty closed tool_call/skill segments, but nothing empty may
      // ever reach renderSegment/CollapsibleBlock ("Executed: Tool" phantom).
      headerSegments: segments.filter(
        s => (s.type === 'thought' || s.type === 'intent') && hasRenderableContent(s)
      ),
      bubbleContent: segments.filter(
        s => s.type !== 'thought' && s.type !== 'intent' && hasRenderableContent(s)
      ),
      sources: isUser ? ([] as ParsedSources) : parseSearchContent(content),
    };
    if (parseCache.size >= PARSE_CACHE_LIMIT) {
      // Map preserves insertion order; evict the oldest entry.
      const oldest = parseCache.keys().next().value;
      if (oldest !== undefined) parseCache.delete(oldest);
    }
    parseCache.set(key, entry);
  }
  return entry;
}

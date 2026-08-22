// @ts-nocheck
import fs from 'fs';
import path from 'path';
import { parseMessage } from '../utils/messageParser';
import { parseSearchContent } from '../utils/sourceParser';

/**
 * Wayfinder #143 regression guard.
 *
 * Original fix memoized the expensive per-message parsers (parseMessage /
 * parseSearchContent) with useMemo inside the FlatList renderItem. That crashed
 * at runtime: renderItem is a plain callback, not a component, so hooks are
 * illegal there (Rules of Hooks) â€” caught live during device E2E on 2026-08-21.
 *
 * The corrected implementation keeps the memoization intent via a module-level,
 * content-keyed parse cache (`getCachedParse`) that renderItem calls. These
 * structural guards assert the cache is used and no hook is called inside
 * renderItem; parser unit assertions below protect the parser contracts.
 */
describe('parse memoization guard (wayfinder #143)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
  const renderItem = source.slice(source.indexOf('renderItem={'));

  it('uses the module-level parse cache per message inside renderItem', () => {
    expect(renderItem).toMatch(
      /getCachedParse\(item\.content, isUser\)/
    );
  });

  it('never calls hooks inside renderItem (Rules of Hooks)', () => {
    expect(renderItem).not.toMatch(/useMemo\(/);
    expect(renderItem).not.toMatch(/useState\(/);
  });

  it('defines a bounded module-level parse cache', () => {
    expect(source).toMatch(/const PARSE_CACHE_LIMIT = \d+/);
    expect(source).toMatch(/const parseCache = new Map</);
    expect(source).toMatch(/function getCachedParse\(/);
  });

  it('cache computes segments, header/bubble filters, and sources without re-parsing hits', () => {
    const fn = source.slice(source.indexOf('function getCachedParse'), source.indexOf('export default function ChatScreen'));
    expect(fn).toMatch(/parseMessage\(content\)/);
    expect(fn).toMatch(/parseSearchContent\(content\)/);
    expect(fn).toMatch(/headerSegments: segments\.filter/);
    expect(fn).toMatch(/bubbleContent: segments\.filter/);
  });

  it('parseMessage still returns the expected text segment', () => {
    const result = parseMessage('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Hello world');
  });

  it('parseMessage still handles thought blocks', () => {
    const result = parseMessage('<thought>Thinking...</thought>Done');
    expect(result.some((s) => s.type === 'thought')).toBe(true);
  });

  it('parseSearchContent still returns an empty array for non-JSON input', () => {
    const result = parseSearchContent('user message');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

import fs from 'fs';
import path from 'path';
import { parseMessage } from '../utils/messageParser';
import { parseSearchContent } from '../utils/sourceParser';

/**
 * Wayfinder #143 regression guard.
 *
 * The fix moves the expensive per-message parsers (parseMessage / parseSearchContent)
 * behind useMemo keyed on [item.content] inside the FlatList renderItem, so that
 * streaming re-renders (appendToken every 100ms) do NOT re-parse every visible
 * message from scratch. The component-level behavior is covered by a structural
 * guard over index.tsx because mounting the full chat screen in jest pulls in
 * expo-router / expo-sqlite dependencies (same constraint documented by #144/#145).
 * The parser unit assertions below protect the parser contracts that renderItem relies on.
 */
describe('parse memoization guard (wayfinder #143)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
  const renderItem = source.slice(source.indexOf('renderItem={'));

  it('memoizes parseMessage per message content inside renderItem', () => {
    expect(renderItem).toMatch(
      /const segments = useMemo\(\(\) => \(isUser \? \[\] : parseMessage\(item\.content\)\), \[item\.content, isUser\]\);/
    );
  });

  it('memoizes the header and bubble segment filters', () => {
    expect(renderItem).toMatch(/const headerSegments = useMemo\(/);
    expect(renderItem).toMatch(/const bubbleContent = useMemo\(/);
  });

  it('memoizes parseSearchContent and removes the per-render parse inside the sources IIFE', () => {
    expect(renderItem).toMatch(/const sources = useMemo\(/);
    expect(renderItem).not.toMatch(/const sources = parseSearchContent/);
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
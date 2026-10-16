import { stripReasoning, EMPTY_RESPONSE_ERROR_HINT } from '../utils/reasoning';

describe('stripReasoning', () => {
  it('strips closed <think> blocks while preserving normal markdown and surrounding text', () => {
    const input = 'Before <think>internal reasoning steps</think> After';
    expect(stripReasoning(input)).toBe('Before  After');
  });

  it('strips multiple <think> blocks', () => {
    const input = '<think>step 1</think>Result 1<think>step 2</think>Result 2';
    expect(stripReasoning(input)).toBe('Result 1Result 2');
  });

  it('preserves code blocks containing <think> tags', () => {
    const input = 'Here is code:\n```xml\n<think>do not strip me</think>\n```\nDone!';
    expect(stripReasoning(input)).toBe('Here is code:\n```xml\n<think>do not strip me</think>\n```\nDone!');
  });

  it('preserves code blocks while stripping <think> tags outside code', () => {
    const input = '<think>strip this</think>\n```typescript\nconst x = "<think>";\n```\n<think>and this</think>\nFinal';
    expect(stripReasoning(input)).toBe('\n```typescript\nconst x = "<think>";\n```\n\nFinal');
  });

  it('is idempotent on plain text, stripped text, and code blocks', () => {
    const input = 'Here is text and ```code <think>block</think>``` end.';
    const once = stripReasoning(input);
    const twice = stripReasoning(once);
    expect(once).toBe(twice);

    const withThink = 'Hello <think>thoughts</think> world';
    const strippedOnce = stripReasoning(withThink);
    const strippedTwice = stripReasoning(strippedOnce);
    expect(strippedOnce).toBe('Hello  world');
    expect(strippedTwice).toBe('Hello  world');
  });

  it('handles case-insensitivity in think tags', () => {
    const input = 'Start <THINK>deep thought</THINK> End';
    expect(stripReasoning(input)).toBe('Start  End');
  });

  it('strips unclosed trailing <think> blocks when insideStreaming is true', () => {
    const input = 'Partial answer <think>currently thinking deeply...';
    expect(stripReasoning(input, true)).toBe('Partial answer ');
  });

  it('strips unclosed trailing <think> blocks even when insideStreaming is false (exhausted maxTokens)', () => {
    const input = 'Partial answer <think>hit maxTokens before completing thought';
    expect(stripReasoning(input, false)).toBe('Partial answer ');
  });

  it('holds back incomplete <think> tag prefixes when streaming', () => {
    expect(stripReasoning('Hello <th', true)).toBe('Hello ');
    expect(stripReasoning('Hello <', true)).toBe('Hello ');
    expect(stripReasoning('Hello </th', true)).toBe('Hello ');
    expect(stripReasoning('Hello `', true)).toBe('Hello ');
    expect(stripReasoning('Hello ``', true)).toBe('Hello ');
  });

  it('handles empty or whitespace strings', () => {
    expect(stripReasoning('')).toBe('');
    expect(stripReasoning('   ')).toBe('   ');
  });

  it('exports EMPTY_RESPONSE_ERROR_HINT with raise maxTokens hint', () => {
    expect(EMPTY_RESPONSE_ERROR_HINT).toContain('Empty response');
    expect(EMPTY_RESPONSE_ERROR_HINT).toContain('maxTokens');
  });
});

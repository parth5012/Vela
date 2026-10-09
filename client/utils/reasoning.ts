/**
 * Module: client/utils/reasoning
 * Intent: Strip internal <think> reasoning blocks from model streams and responses.
 * Responsibilities:
 *  - Pure string transformation removing <think>...</think> segments.
 *  - Preserves normal markdown code fences (```...```).
 *  - Handles partial/unclosed <think> blocks during streaming.
 *  - Idempotent and pure with zero side-effects.
 */

export const EMPTY_RESPONSE_ERROR_HINT = 'Empty response — try raising maxTokens';

/**
 * Matches trailing incomplete <think> / </think> tag prefixes or code fence delimiters.
 */
const INCOMPLETE_TRAILING_REGEX = /(?:`{1,2}|<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?)$/i;

/**
 * Strips reasoning (<think>...</think>) blocks from text while preserving
 * code fences (```...```).
 *
 * An unclosed trailing `<think>...` extending to the end of a non-code segment
 * is always stripped (both during streaming and in final assembly) because
 * internal reasoning must never be surfaced even if maxTokens is exhausted mid-thought.
 *
 * If insideStreaming is true, an incomplete trailing `<think>` / `</think>` prefix
 * or code fence delimiter is held back until subsequent chunks arrive.
 */
export function stripReasoning(text: string, insideStreaming = false): string {
  if (!text) return '';

  // Split by code blocks (```...```) to preserve them untouched
  const segments = text.split(/(```[\s\S]*?(?:```|$))/g);

  const cleaned = segments.map((segment, index) => {
    if (segment.startsWith('```')) {
      // Code fence: preserve untouched
      return segment;
    }

    // Strip closed <think>...</think> blocks (case-insensitive)
    let processed = segment.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Always strip unclosed trailing <think>... in both streaming and final mode;
    // reasoning is internal either way (e.g. maxTokens exhausted mid-thought).
    // Note: a legitimate unclosed literal <think> in prose will be dropped.
    processed = processed.replace(/<think>[\s\S]*$/gi, '');

    // Strip any orphan </think> tags outside code fences
    processed = processed.replace(/<\/think>/gi, '');

    // If streaming and this is the last segment, hold back incomplete trailing tag prefixes or code fences
    if (insideStreaming && index === segments.length - 1) {
      processed = processed.replace(INCOMPLETE_TRAILING_REGEX, '');
    }

    return processed;
  });

  return cleaned.join('');
}

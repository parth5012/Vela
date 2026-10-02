export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

export interface BuildContextOptions {
  maxMessages?: number;
  maxTokensEstimate?: number;
}

export function buildContextMessages(
  messages: Array<{ id?: string; role: 'user' | 'assistant' | 'system'; content: string; created_at?: string }>,
  options: BuildContextOptions = {}
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  const maxMessages = options.maxMessages || 30;
  const maxTokensEstimate = options.maxTokensEstimate || 12000;

  // Filter out empty assistant messages
  const valid = messages.filter((m) => {
    if (m.role === 'assistant' && !m.content?.trim()) {
      return false;
    }
    return Boolean(m.content?.trim());
  });

  // Take recent messages up to maxMessages
  const recent = valid.slice(-maxMessages);

  // Approximate token truncation: ~4 characters per token
  const result: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  let tokenCount = 0;

  // Iterate backwards to keep the most recent messages
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    const estimatedTokens = Math.ceil((msg.content?.length || 0) / 4);
    if (tokenCount + estimatedTokens > maxTokensEstimate && result.length > 0) {
      break;
    }
    tokenCount += estimatedTokens;
    result.unshift({
      role: msg.role,
      content: msg.content.trim(),
    });
  }

  // Strict APIs (Anthropic/Gemini) reject history starting with an assistant message
  while (result.length > 1 && result[0].role === 'assistant') {
    result.shift();
  }

  return result;
}

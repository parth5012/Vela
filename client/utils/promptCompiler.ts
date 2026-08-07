import { Message } from '../store/useChatStore';

export interface CompileLocalPromptParams {
  systemPrompt: string;
  history: Message[];
  query: string;
  compactInstructions?: string;
  toolDeclarations?: string[];
}

const CHAR_LIMIT_SYSTEM = 1200; // ~300 tokens
const CHAR_LIMIT_TOOLS = 800;   // ~200 tokens
const CHAR_LIMIT_TOTAL = 8000;  // 2K tokens limit

/**
 * Formats prompt inputs into structured XML blocks for the local LLM.
 * Dynamically truncates conversation history message-by-message, starting from the oldest,
 * until the entire compiled prompt fits within the 2K token budget limit.
 */
export function compileLocalPrompt(params: CompileLocalPromptParams): string {
  const { systemPrompt, history, query, compactInstructions, toolDeclarations } = params;

  // 1. Process System Instructions (Limit to ~300 tokens / 1200 chars)
  let systemContent = systemPrompt || '';
  if (compactInstructions) {
    systemContent = systemContent ? `${systemContent}\n${compactInstructions}` : compactInstructions;
  }
  if (systemContent.length > CHAR_LIMIT_SYSTEM) {
    systemContent = systemContent.substring(0, CHAR_LIMIT_SYSTEM);
  }

  // 2. Process Tools (Limit to ~200 tokens / 800 chars)
  let toolsContent = '';
  if (toolDeclarations && toolDeclarations.length > 0) {
    const rawTools = toolDeclarations.join('\n');
    if (rawTools.length > CHAR_LIMIT_TOOLS) {
      toolsContent = rawTools.substring(0, CHAR_LIMIT_TOOLS);
    } else {
      toolsContent = rawTools;
    }
  }

  // 3. Process current User Query (Always included)
  const userContent = (query || '').trim();

  // Helper function to build the final prompt from custom history slice
  const buildFinalPrompt = (historySlice: Message[]): string => {
    let prompt = '<system>\n' + systemContent + '\n</system>\n';

    if (toolsContent) {
      prompt += '<tools>\n' + toolsContent + '\n</tools>\n';
    }

    if (historySlice.length > 0) {
      prompt += '<history>\n';
      for (const msg of historySlice) {
        prompt += `<message role="${msg.role}">${msg.content}</message>\n`;
      }
      prompt += '</history>\n';
    }

    prompt += '<user>\n' + userContent + '\n</user>';
    return prompt;
  };

  // 4. Incrementally prune history message-by-message until overall compiled prompt fits budget
  let activeHistory = [...history];
  let compiledPrompt = buildFinalPrompt(activeHistory);

  while (compiledPrompt.length > CHAR_LIMIT_TOTAL && activeHistory.length > 0) {
    // Prune the oldest message (first item in history)
    activeHistory.shift();
    compiledPrompt = buildFinalPrompt(activeHistory);
  }

  return compiledPrompt;
}

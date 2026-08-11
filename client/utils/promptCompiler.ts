import { Message } from '../store/useChatStore';

export interface CompileLocalPromptParams {
  systemPrompt: string;
  history: Message[];
  query: string;
  compactInstructions?: string;
  toolDeclarations?: string[];
  modelName?: string;
}

const CHAR_LIMIT_SYSTEM = 1200; //~300 tokens
const CHAR_LIMIT_TOOLS = 800; //~200 tokens
const CHAR_LIMIT_TOTAL = 8000; //2K tokens limit

/**
 * Formats prompt inputs structured XML blocks local LLM.
 * Dynamically truncates conversation history message-by-message, starting oldest,
 * until entire compiled prompt fits within 2K token budget limit.
 */
export function compileLocalPrompt(params: CompileLocalPromptParams): string {
  const { systemPrompt, history, query, compactInstructions, toolDeclarations, modelName = 'xml' } = params;

  //1. Process SystemInstructions (Limit to ~300 tokens / 1200 chars)
  let systemContent = systemPrompt || '';
  if (compactInstructions) {
    systemContent = systemContent ? `${systemContent}\n${compactInstructions}` : compactInstructions;
  }
  if (systemContent.length > CHAR_LIMIT_SYSTEM) {
    systemContent = systemContent.substring(0, CHAR_LIMIT_SYSTEM);
  }

  //2. ProcessTools (Limit to ~200 tokens / 800 chars)
  let toolsContent = '';
  if (toolDeclarations && toolDeclarations.length > 0) {
    const rawTools = toolDeclarations.join('\n');
    if (rawTools.length > CHAR_LIMIT_TOOLS) {
      toolsContent = rawTools.substring(0, CHAR_LIMIT_TOOLS);
    } else {
      toolsContent = rawTools;
    }
  }

  //3. Process current UserQuery (Always included)
  const userContent = (query || '').trim();

  //Helper function build final prompt custom history slice
  const buildFinalPrompt = (historySlice: Message[]): string => {
    if (modelName === 'xml') {
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
    } else if (modelName === 'TinyLlama 1.1B') {
      let prompt = `<|system|>\n${systemContent}`;
      if (toolsContent) {
        prompt += `\n\nAvailable tools:\n${toolsContent}`;
      }
      prompt += '</s>\n';

      for (const msg of historySlice) {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        prompt += `<|${role}|>\n${msg.content}</s>\n`;
      }

      prompt += `<|user|>\n${userContent}</s>\n<|assistant|>\n`;
      return prompt;
    } else if (modelName === 'Llama 3.2 1B (GGUF)') {
      // Llama 3.x chat template (used by the "Llama 3.2 1B (GGUF)" model)
      let prompt = `<|start_header_id|>system<|end_header_id|>\n\n${systemContent}`;
      if (toolsContent) {
        prompt += `\n\nAvailable tools:\n${toolsContent}`;
      }
      prompt += '<|eot_id|>\n';

      for (const msg of historySlice) {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        prompt += `<|start_header_id|>${role}<|end_header_id|>\n\n${msg.content}<|eot_id|>\n`;
      }

      prompt += `<|start_header_id|>user<|end_header_id|>\n\n${userContent}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n\n`;
      return prompt;
    } else if (modelName === 'Phi-4 Mini (GGUF)') {
      // Phi-4 chat template (used by the "Phi-4 Mini (GGUF)" model)
      let prompt = `<|system|>\n${systemContent}`;
      if (toolsContent) {
        prompt += `\n\nAvailable tools:\n${toolsContent}`;
      }
      prompt += '<|end|>\n';

      for (const msg of historySlice) {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        prompt += `<|${role}|>\n${msg.content}<|end|>\n`;
      }

      prompt += `<|user|>\n${userContent}<|end|>\n<|assistant|>\n`;
      return prompt;
    } else if (modelName === 'DeepSeek-R1 1.5B (GGUF)') {
      // DeepSeek-R1 chat template (used by "DeepSeek-R1 1.5B (GGUF)")
      let prompt = `${systemContent}\n\n`;
      if (toolsContent) {
        prompt += `Available tools:\n${toolsContent}\n\n`;
      }

      for (const msg of historySlice) {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        prompt += `<｜${role}｜>\n${msg.content}\n`;
      }

      prompt += `<｜User｜>\n${userContent}\n<｜Assistant｜>\n`;
      return prompt;
    } else {
      // Default: ChatML for Qwen2.5 0.5B, SmolLM 135M & default fallback
      let prompt = `<|im_start|>system\n${systemContent}`;
      if (toolsContent) {
        prompt += `\n\nAvailable tools:\n${toolsContent}`;
      }
      prompt += '<|im_end|>\n';

      for (const msg of historySlice) {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        prompt += `<|im_start|>${role}\n${msg.content}<|im_end|>\n`;
      }

      prompt += `<|im_start|>user\n${userContent}<|im_end|>\n<|im_start|>assistant\n`;
      return prompt;
    }
  };

  //4. Incrementally prune history message-by-message until overall compiled prompt fits budget
  let activeHistory = [...history];
  let compiledPrompt = buildFinalPrompt(activeHistory);

  while (compiledPrompt.length > CHAR_LIMIT_TOTAL && activeHistory.length > 0) {
    //Prune oldestmessage (first item in history)
    activeHistory.shift();
    compiledPrompt = buildFinalPrompt(activeHistory);
  }

  return compiledPrompt;
}
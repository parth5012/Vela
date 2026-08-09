import { compileLocalPrompt } from '../utils/promptCompiler';
import { Message } from '../store/useChatStore';

describe('promptCompiler utility', () => {
  const defaultParams = {
    systemPrompt: 'System instructions.',
    history: [] as Message[],
    query: 'What is 2+2?',
  };

  it('should format simple prompts without tools history correctly', () => {
    const result = compileLocalPrompt(defaultParams);

    expect(result).toContain('<system>\nSystem instructions.\n</system>');
    expect(result).not.toContain('<tools>');
    expect(result).not.toContain('<history>');
    expect(result).toContain('<user>\nWhat is 2+2?\n</user>');
  });

  it('should include compact instructions tools when provided', () => {
    const params = {
      ...defaultParams,
      compactInstructions: 'Be extremely concise.',
      toolDeclarations: ['tool_foo', 'tool_bar'],
    };

    const result = compileLocalPrompt(params);

    expect(result).toContain('<system>\nSystem instructions.\nBe extremely concise.\n</system>');
    expect(result).toContain('<tools>\ntool_foo\ntool_bar\n</tools>');
  });

  it('should enforce limits system content tools', () => {
    const superLongSystem = 'A'.repeat(2000);
    const superLongTools = ['B'.repeat(1000)];

    const params = {
      ...defaultParams,
      systemPrompt: superLongSystem,
      toolDeclarations: superLongTools,
    };

    const result = compileLocalPrompt(params);

    //Verify system content truncated 1200
    const systemBlock = /<system>\n([\s\S]*?)\n<\/system>/.exec(result)?.[1] || '';
    expect(systemBlock.length).toBe(1200);

    //Verify tools block truncated 800
    const toolsBlock = /<tools>\n([\s\S]*?)\n<\/tools>/.exec(result)?.[1] || '';
    expect(toolsBlock.length).toBe(800);
  });

  it('should render history messages correctly', () => {
    const history: Message[] = [
      { id: '1', role: 'user' as const, content: 'Hello' },
      { id: '2', role: 'assistant' as const, content: 'Hi there!' },
    ];

    const params = {
      ...defaultParams,
      history,
    };

    const result = compileLocalPrompt(params);

    expect(result).toContain('<history>');
    expect(result).toContain('<message role="user">Hello</message>');
    expect(result).toContain('<message role="assistant">Hi there!</message>');
  });

  it('should prune history message-by-message, starting oldest, fit total limit', () => {
    //Total character limit 8000.
    //Query 10 chars. System ~20 chars.
    //construct history msg_1 msg_2 MUST pruned fit under 8000.
    const history: Message[] = [
      { id: 'msg_1', role: 'user' as const, content: 'A'.repeat(2000) }, //Oldest: pruned
      { id: 'msg_2', role: 'assistant' as const, content: 'B'.repeat(2000) }, //pruned
      { id: 'msg_3', role: 'user' as const, content: 'C'.repeat(3500) }, //Preserved
      { id: 'msg_4', role: 'assistant' as const, content: 'D'.repeat(3500) }, //Preserved
      { id: 'msg_5', role: 'user' as const, content: 'E'.repeat(100) }, //Preserved
    ];

    const params = {
      ...defaultParams,
      history,
    };

    const result = compileLocalPrompt(params);

    expect(result.length).toBeLessThanOrEqual(8000);
    //Verifies oldest ones pruned
    expect(result).not.toContain('A'.repeat(2000));
    expect(result).not.toContain('B'.repeat(2000));
    //Verifies newer ones preserved
    expect(result).toContain('C'.repeat(3500));
    expect(result).toContain('D'.repeat(3500));
    expect(result).toContain('E'.repeat(100));
  });

  it('should format ChatML correctly (for Qwen2.5 / SmolLM / fallback)', () => {
    const params = {
      ...defaultParams,
      compactInstructions: 'Be extremely concise.',
      toolDeclarations: ['tool_foo'],
      modelName: 'Qwen2.5 0.5B',
    };

    const result = compileLocalPrompt(params);

    expect(result).toContain('<|im_start|>system\nSystem instructions.\nBe extremely concise.');
    expect(result).toContain('Available tools:\ntool_foo');
    expect(result).toContain('<|im_end|>');
    expect(result).toContain('<|im_start|>user\nWhat is 2+2?<|im_end|>\n<|im_start|>assistant\n');
  });

  it('should format TinyLlama template correctly', () => {
    const params = {
      ...defaultParams,
      compactInstructions: 'Be extremely concise.',
      toolDeclarations: ['tool_foo'],
      modelName: 'TinyLlama 1.1B',
    };

    const result = compileLocalPrompt(params);

    expect(result).toContain('<|system|>\nSystem instructions.\nBe extremely concise.');
    expect(result).toContain('Available tools:\ntool_foo');
    expect(result).toContain('</s>\n');
    expect(result).toContain('<|user|>\nWhat is 2+2?</s>\n<|assistant|>\n');
  });
});

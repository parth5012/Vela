import { parseMessage, hasRenderableContent, MessageSegment } from '../utils/messageParser';

describe('messageParser', () => {
  it('should parse standard text without any tags', () => {
    const text = 'Hello world, this is a plain text.';
    const result = parseMessage(text);
    expect(result).toEqual([
      { type: 'text', content: 'Hello world, this is a plain text.', isClosed: true }
    ]);
  });

  it('should parse closed thought block', () => {
    const text = '<thought>Thinking about rendering...</thought>Ready to display.';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'thought',
        isClosed: true,
        children: [
          { type: 'text', content: 'Thinking about rendering...', isClosed: true }
        ]
      },
      { type: 'text', content: 'Ready to display.', isClosed: true }
    ]);
  });

  it('should parse incomplete/streaming thought block', () => {
    const text = '<thought>Currently thinking about the next step';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'thought',
        isClosed: false,
        children: [
          { type: 'text', content: 'Currently thinking about the next step', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse tool call block with input', () => {
    const text = 'Running command:\n<call:default_api:run_command input="{\\"CommandLine\\":\\"ls -la\\"}">file1.txt\nfile2.txt</call:default_api:run_command>\nExecution done.';
    const result = parseMessage(text);
    expect(result).toEqual([
      { type: 'text', content: 'Running command:\n', isClosed: true },
      {
        type: 'tool_call',
        name: 'default_api:run_command',
        input: '{\\"CommandLine\\":\\"ls -la\\"}',
        isClosed: true,
        children: [
          { type: 'text', content: 'file1.txt\nfile2.txt', isClosed: true }
        ]
      },
      { type: 'text', content: '\nExecution done.', isClosed: true }
    ]);
  });

  it('should parse tool call with single-quoted input', () => {
    const text = `<call:default_api:view_file input='{"AbsolutePath":"/test.txt"}'>hello</call:default_api:view_file>`;
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'tool_call',
        name: 'default_api:view_file',
        input: '{"AbsolutePath":"/test.txt"}',
        isClosed: true,
        children: [
          { type: 'text', content: 'hello', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse incomplete/streaming tool call opening tag', () => {
    const text = '<call:default_api:run_command input="{\\"Command';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'tool_call',
        name: 'default_api:run_command',
        input: '{\\"Command',
        isClosed: false,
        children: []
      }
    ]);
  });

  it('should parse tool call with open body (streaming content)', () => {
    const text = '<call:default_api:run_command input="{\\"CommandLine\\":\\"pwd\\"}">/users/test/workspace';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'tool_call',
        name: 'default_api:run_command',
        input: '{\\"CommandLine\\":\\"pwd\\"}',
        isClosed: false,
        children: [
          { type: 'text', content: '/users/test/workspace', isClosed: true }
        ]
      }
    ]);
  });

  it('should handle complex mixed streams containing text, thoughts, and tool calls', () => {
    const text = 'Starting...\n<thought>Thinking 1</thought>Mid text\n<call:toolA input="argsA">outputA</call:toolA>\n<thought>Thinking 2';
    const result = parseMessage(text);
    expect(result).toEqual([
      { type: 'text', content: 'Starting...\n', isClosed: true },
      {
        type: 'thought',
        isClosed: true,
        children: [
          { type: 'text', content: 'Thinking 1', isClosed: true }
        ]
      },
      { type: 'text', content: 'Mid text\n', isClosed: true },
      {
        type: 'tool_call',
        name: 'toolA',
        input: 'argsA',
        isClosed: true,
        children: [
          { type: 'text', content: 'outputA', isClosed: true }
        ]
      },
      { type: 'text', content: '\n', isClosed: true },
      {
        type: 'thought',
        isClosed: false,
        children: [
          { type: 'text', content: 'Thinking 2', isClosed: true }
        ]
      }
    ]);
  });

  it('should handle tool call inputs containing greater than signs', () => {
    const text = '<call:default_api:run_command input="{\\"CommandLine\\":\\"echo 1 > out.txt\\"}">Success</call:default_api:run_command>';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'tool_call',
        name: 'default_api:run_command',
        input: '{\\"CommandLine\\":\\"echo 1 > out.txt\\"}',
        isClosed: true,
        children: [
          { type: 'text', content: 'Success', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse nested tool calls hierarchically', () => {
    const text = '<call:web_search input="query_1"><call:tavily_search input="query_2">tavily_output</call:tavily_search>web_output</call:web_search>';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'tool_call',
        name: 'web_search',
        input: 'query_1',
        isClosed: true,
        children: [
          {
            type: 'tool_call',
            name: 'tavily_search',
            input: 'query_2',
            isClosed: true,
            children: [
              { type: 'text', content: 'tavily_output', isClosed: true }
            ]
          },
          { type: 'text', content: 'web_output', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse closed intent block', () => {
    const text = '<intent>Goal is to list files.</intent>Ready.';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'intent',
        isClosed: true,
        children: [
          { type: 'text', content: 'Goal is to list files.', isClosed: true }
        ]
      },
      { type: 'text', content: 'Ready.', isClosed: true }
    ]);
  });

  it('should parse incomplete/streaming intent block', () => {
    const text = '<intent>Currently parsing intent';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'intent',
        isClosed: false,
        children: [
          { type: 'text', content: 'Currently parsing intent', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse skill block with input', () => {
    const text = '<skill:custom_search input="{\\"query\\":\\"react\\"}">results</skill:custom_search>';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'skill',
        name: 'custom_search',
        input: '{\\"query\\":\\"react\\"}',
        isClosed: true,
        children: [
          { type: 'text', content: 'results', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse incomplete/streaming skill block', () => {
    const text = '<skill:custom_search input="{\\"query\\":\\"react\\"}">fetching';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'skill',
        name: 'custom_search',
        input: '{\\"query\\":\\"react\\"}',
        isClosed: false,
        children: [
          { type: 'text', content: 'fetching', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse closed skill block without input', () => {
    const text = '<skill:custom_search>results</skill:custom_search>';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'skill',
        name: 'custom_search',
        isClosed: true,
        children: [
          { type: 'text', content: 'results', isClosed: true }
        ]
      }
    ]);
  });

  it('should handle complex mixed streams containing thoughts, intents, skills, and tool calls', () => {
    const text = 'Starting...\n<intent>Identify user need</intent>\n<thought>Thinking...</thought>\n<skill:search input="query">search_out</skill:search>\n<call:execute>done</call:execute>';
    const result = parseMessage(text);
    expect(result).toEqual([
      { type: 'text', content: 'Starting...\n', isClosed: true },
      {
        type: 'intent',
        isClosed: true,
        children: [{ type: 'text', content: 'Identify user need', isClosed: true }]
      },
      { type: 'text', content: '\n', isClosed: true },
      {
        type: 'thought',
        isClosed: true,
        children: [{ type: 'text', content: 'Thinking...', isClosed: true }]
      },
      { type: 'text', content: '\n', isClosed: true },
      {
        type: 'skill',
        name: 'search',
        input: 'query',
        isClosed: true,
        children: [{ type: 'text', content: 'search_out', isClosed: true }]
      },
      { type: 'text', content: '\n', isClosed: true },
      {
        type: 'tool_call',
        name: 'execute',
        isClosed: true,
        children: [{ type: 'text', content: 'done', isClosed: true }]
      }
    ]);
  });
});

describe('messageParser phantom tool_call guard (#150)', () => {
  it('parses the mock-server thought response to exactly [thought, text] with zero tool_call segments', () => {
    const text = '<thought>User asked: what is the capital of France. I should answer directly.</thought>[PERSONA] The capital of France is Paris.';
    const result = parseMessage(text);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('thought');
    expect(result[0].isClosed).toBe(true);
    expect(result[1]).toEqual({
      type: 'text',
      content: '[PERSONA] The capital of France is Paris.',
      isClosed: true
    });
    expect(result.some((s) => s.type === 'tool_call')).toBe(false);
    // No nested tool_call anywhere in the tree either.
    const countToolCalls = (segments: MessageSegment[]): number =>
      segments.reduce(
        (n, s) => n + (s.type === 'tool_call' ? 1 : 0) + countToolCalls(s.children || []),
        0
      );
    expect(countToolCalls(result)).toBe(0);
  });

  it('emits a bare mid-string <call:> fragment as literal text, not a tool_call node', () => {
    const result = parseMessage('before <call:> after');
    expect(result).toEqual([
      { type: 'text', content: 'before <call:> after', isClosed: true }
    ]);
  });

  it('emits a bare end-of-stream <call: fragment as literal text', () => {
    const result = parseMessage('thinking about calling <call:');
    expect(result).toEqual([
      { type: 'text', content: 'thinking about calling <call:', isClosed: true }
    ]);
  });

  it('emits a bare mid-string <skill:> fragment as literal text, not a skill node', () => {
    const result = parseMessage('before <skill:> after');
    expect(result).toEqual([
      { type: 'text', content: 'before <skill:> after', isClosed: true }
    ]);
  });

  it('emits a bare end-of-stream <skill: fragment as literal text', () => {
    const result = parseMessage('about to invoke <skill:');
    expect(result).toEqual([
      { type: 'text', content: 'about to invoke <skill:', isClosed: true }
    ]);
  });

  it('never fabricates a nameless "Tool"/"Skill" node for malformed fragments', () => {
    const inputs = [
      '<call:',
      '<call:>',
      'x <call: y',
      '<skill:',
      '<skill:>',
      'x <skill: y',
    ];
    for (const text of inputs) {
      const result = parseMessage(text);
      const flat = JSON.stringify(result);
      expect(flat).not.toContain('"name":"Tool"');
      expect(flat).not.toContain('"name":"Skill"');
      expect(flat).not.toContain('"type":"tool_call"');
      expect(flat).not.toContain('"type":"skill"');
    }
  });

  it('keeps a legitimately named tool_call nested inside a closed thought', () => {
    const text = '<thought>a <call:webview_browser input="{}"></call:webview_browser></thought>';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'thought',
        isClosed: true,
        children: [
          { type: 'text', content: 'a ', isClosed: true },
          {
            type: 'tool_call',
            name: 'webview_browser',
            input: '{}',
            isClosed: true,
            children: []
          }
        ]
      }
    ]);
  });

  it('keeps parsing after a bare fragment - a later legit call is unaffected', () => {
    const text = '<call:> then <call:web_search></call:web_search>';
    const result = parseMessage(text);
    expect(result).toEqual([
      { type: 'text', content: '<call:> then ', isClosed: true },
      { type: 'tool_call', name: 'web_search', isClosed: true, children: [] }
    ]);
  });

  it('keeps a bare fragment as literal text inside a thought', () => {
    const result = parseMessage('<thought>hmm <call:> weird</thought>');
    expect(result).toEqual([
      {
        type: 'thought',
        isClosed: true,
        children: [
          { type: 'text', content: 'hmm <call:> weird', isClosed: true }
        ]
      }
    ]);
  });

  it('keeps a streaming (open) skill awaiting content - sweep only drops CLOSED blocks', () => {
    const result = parseMessage('<skill:code_review');
    expect(result).toEqual([
      { type: 'skill', name: 'code_review', isClosed: false, children: [] }
    ]);
  });

  it('keeps a streaming (open) tool_call awaiting content - no over-filtering', () => {
    const text = '<call:default_api:run_command input="{\\"Command';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'tool_call',
        name: 'default_api:run_command',
        input: '{\\"Command',
        isClosed: false,
        children: []
      }
    ]);
  });

  describe('hasRenderableContent', () => {
    const base = { isClosed: true } as const;

    it('returns false for empty tool_call/skill segments', () => {
      expect(hasRenderableContent({ type: 'tool_call', ...base })).toBe(false);
      expect(hasRenderableContent({ type: 'skill', ...base })).toBe(false);
    });

    it('returns true when a tool_call/skill has a name, input, or children', () => {
      expect(hasRenderableContent({ type: 'tool_call', name: 'x', ...base })).toBe(true);
      expect(hasRenderableContent({ type: 'tool_call', input: '{}', ...base })).toBe(true);
      expect(
        hasRenderableContent({
          type: 'tool_call',
          ...base,
          children: [{ type: 'text', content: 'out', isClosed: true }]
        })
      ).toBe(true);
      expect(hasRenderableContent({ type: 'skill', name: 's', ...base })).toBe(true);
    });

    it('returns true for non-block segment types regardless of payload', () => {
      expect(hasRenderableContent({ type: 'text', content: '', ...base })).toBe(true);
      expect(hasRenderableContent({ type: 'thought', ...base })).toBe(true);
      expect(hasRenderableContent({ type: 'intent', ...base })).toBe(true);
    });
  });
});


import { parseAndExecuteTools } from '../utils/toolProxy';

globalThis.fetch = jest.fn();

describe('toolProxy parser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis.fetch as jest.Mock).mockReset();
  });

  it('should pass through normal text with hasInvocations false', async () => {
    const content = 'Hello world, this is a normal message.';
    const result = await parseAndExecuteTools(content, 'thread_123', 'https://api.run', 'api_key');

    expect(result.hasInvocations).toBe(false);
    expect(result.updatedContent).toBe(content);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should parse call block, invoke fetch, and append response block on success', async () => {
    const content = 'Let me look that up: <call name="google_search">{"query": "Vela assistant"}</call> and write it.';
    
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        result: 'Here is what I found about Vela assistant.',
      }),
    });

    const result = await parseAndExecuteTools(content, 'thread_123', 'https://api.run', 'api_key');

    expect(result.hasInvocations).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.run/api/tools/invoke', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer api_key',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: expect.stringContaining('"tool_name":"google_search"'),
    });

    expect(result.updatedContent).toContain(
      '<call name="google_search">{"query": "Vela assistant"}</call>\n<response name="google_search">\nHere is what I found about Vela assistant.\n</response>'
    );
  });

  it('should handle tool invocation backend error payload', async () => {
    const content = '<call name="get_weather">{"city": "Paris"}</call>';

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'error',
        error: {
          message: 'City not found',
        },
      }),
    });

    const result = await parseAndExecuteTools(content, 'thread_123', 'https://api.run', 'api_key');

    expect(result.hasInvocations).toBe(true);
    expect(result.updatedContent).toContain('<response name="get_weather">\nError: City not found\n</response>');
  });

  it('should handle fetch request execution failure or network error', async () => {
    const content = '<call name="send_email">{"to": "test@test.local"}</call>';

    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error('Fatal connection issue'));

    const result = await parseAndExecuteTools(content, 'thread_123', 'https://api.run', 'api_key');

    expect(result.hasInvocations).toBe(true);
    expect(result.updatedContent).toContain('<response name="send_email">\nError: Fatal connection issue\n</response>');
  });
});

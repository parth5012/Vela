import { parseAndExecuteTools } from '../utils/toolProxy';
import * as cloudTools from '../utils/cloudTools';

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

  describe('standalone mode tool execution & degradation in toolProxy', () => {
    it('executes standalone tool directly without server fetch in local mode', async () => {
      const content = '<call name="save_user_memory">{"fact": "User is a designer"}</call>';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(result.updatedContent).toContain('<response name="save_user_memory">');
      expect(result.updatedContent).toContain("Successfully saved new memory: 'User is a designer'");
    });

    it('returns graceful degradation hint when calling server-only tool in local mode', async () => {
      const content = '<call name="gmail_send_email">{"to": "alice@example.com"}</call>';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(result.updatedContent).toContain(
        '<response name="gmail_send_email">\ngmail_send_email is unavailable in standalone mode — connect to server for full access.\n</response>'
      );
    });

    it('returns unknown tool error when tool is not registered', async () => {
      const content = '<call name="imaginary_tool">{}</call>';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(true);
      expect(result.updatedContent).toContain('Error: Unknown tool "imaginary_tool".');
    });

    it('executes device tool in standalone mode and returns tool output', async () => {
      const content = '<call name="device_screen_read">{}</call>';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(true);
      expect(result.updatedContent).toContain('<response name="device_screen_read">');
    });
  });

  // Needle (.cact) engines answer with a JSON envelope instead of the GGUF
  // `<call>` XML the compiled prompt asks for, so the local chat path has to
  // recognise that shape too — otherwise the call renders as text and nothing
  // is executed (on-device report, PR #277).
  describe('needle JSON envelope dispatch', () => {
    it('executes a device tool from the real engine envelope', async () => {
      const content =
        '{"type":"call","function_calls":[{"name":"device_screen_read","arguments":{}}],"confidence":0.91}';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(result.updatedContent).toContain('<response name="device_screen_read">');
    });

    it('maps Needle argument names onto the executor target/value slots', async () => {
      const spy = jest
        .spyOn(cloudTools, 'executeCloudTool')
        .mockResolvedValue({ success: true, output: 'opened Settings' });

      const content =
        '{"type":"call","function_calls":[{"name":"device_open_app","arguments":{"app":"Settings"}}]}';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(spy).toHaveBeenCalledWith(
        'device_open_app',
        expect.objectContaining({ target: 'Settings', app: 'Settings' })
      );
      expect(result.hasInvocations).toBe(true);
      expect(result.updatedContent).toContain('<response name="device_open_app">\nopened Settings\n</response>');
      // The envelope is still shown above the observation for traceability.
      expect(result.updatedContent).toContain('"function_calls"');

      spy.mockRestore();
    });

    it('dispatches the flat mock shape too', async () => {
      const content = '{"name":"device_info","arguments":{},"confidence":0.5}';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(true);
      expect(result.updatedContent).toContain('<response name="device_info">');
    });

    it('never executes a refusal envelope', async () => {
      const content = '{"type":"call","function_calls":[],"reasoning":"No device action fits."}';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(false);
      expect(result.updatedContent).toBe(content);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('leaves plain JSON that is not a tool call alone', async () => {
      const content = 'Here is the schema you asked for: {"type":"object","properties":{}}';

      const result = await parseAndExecuteTools(
        content,
        'thread_123',
        undefined,
        undefined,
        'local'
      );

      expect(result.hasInvocations).toBe(false);
      expect(result.updatedContent).toBe(content);
    });
  });
});

import { buildCloudToolDescriptions, buildVercelCloudTools, executeCloudTool, listCloudToolNames } from '../utils/cloudTools'

describe('cloudTools', () => {
  it('lists cloud tools without server-only entries', () => {
    const names = listCloudToolNames()

    expect(names).toContain('device_screen_read')
    expect(names).not.toContain('gmail_send_email')
    expect(names).not.toContain('save_user_memory')
  })

  it('builds description map for Vercel tool wiring', () => {
    const descriptions = buildCloudToolDescriptions()

    expect(descriptions['web_search']).toBeDefined()
    expect(descriptions['gmail_send_email']).toBeUndefined()
  })

  it('executes device tools via injected executor', async () => {
    const executeDevice = jest.fn(async () => ({ outcome: 'executed' as const, observation: 'Success' }))

    const result = await executeCloudTool('device_screen_read', {}, { executeDevice })

    expect(result.success).toBe(true)
    expect(result.output).toBe('Success')
    expect(executeDevice).toHaveBeenCalledWith('device_screen_read', undefined, undefined)
  })

  it('rejects unknown tools without throwing', async () => {
    const result = await executeCloudTool('gmail_send_email', {})

    expect(result.success).toBe(false)
  })

  it('rejects unregistered device names without executing', async () => {
    const executeDevice = jest.fn(async () => ({ outcome: 'executed' as const, observation: 'Success' }))

    const result = await executeCloudTool('device_unknown', {}, { executeDevice })

    expect(result.success).toBe(false)
    expect(executeDevice).not.toHaveBeenCalled()
  })

  it('reports failure when web search rejects', async () => {
    const webSearch = jest.fn(async () => {
      throw new Error('down')
    })

    const result = await executeCloudTool('web_search', { query: 'vela' }, { webSearch })

    expect(result.success).toBe(false)
    expect(result.output).toContain('Search failed')
  })

  it('builds Vercel AI SDK compatible tool definitions and executes through callbacks', async () => {
    const executeDevice = jest.fn(async () => ({ outcome: 'executed' as const, observation: 'Tapped' }))
    const onToolCall = jest.fn()
    const onToolResult = jest.fn()

    const tools = buildVercelCloudTools({}, { executeDevice }, { onToolCall, onToolResult })
    expect(tools.device_tap).toBeDefined()
    expect(tools.device_tap.description).toContain('Taps an element')

    const output = await tools.device_tap.execute({ target: '100,200' })
    expect(output).toBe('Tapped')
    expect(onToolCall).toHaveBeenCalledWith({ toolName: 'device_tap', args: { target: '100,200' } })
    expect(onToolResult).toHaveBeenCalledWith({
      toolName: 'device_tap',
      result: { success: true, output: 'Tapped' },
    })
  })
})

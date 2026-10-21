import { buildCloudToolDescriptions, buildVercelCloudTools, executeCloudTool, listCloudToolNames } from '../utils/cloudTools'

describe('cloudTools', () => {
  it('lists cloud tools without server-only entries', () => {
    const names = listCloudToolNames()

    expect(names).toContain('device_screen_read')
    expect(names).toContain('save_user_memory')
    expect(names).toContain('delete_user_memory')
    expect(names).not.toContain('gmail_send_email')
    expect(names).not.toContain('webview_browser')
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

  it('delegates run_device_automation to the Needle bridge', async () => {
    const runNeedleAutomation = jest.fn(async () => ({
      ok: true,
      output: '1. device_open_app (target=Settings) -> executed: Opened Settings\nResult: completed in 1 step(s).',
      model: 'Needle-3 (20-layer)',
      steps: 1,
    }))

    const result = await executeCloudTool(
      'run_device_automation',
      { instruction: 'open Settings', max_steps: '3', conversation_id: 'c1' },
      { runNeedleAutomation }
    )

    expect(runNeedleAutomation).toHaveBeenCalledWith('open Settings', {
      conversationId: 'c1',
      maxSteps: 3,
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Opened Settings')
  })

  it('rejects run_device_automation without an instruction', async () => {
    const runNeedleAutomation = jest.fn()

    const result = await executeCloudTool('run_device_automation', {}, { runNeedleAutomation })

    expect(runNeedleAutomation).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.output).toContain('needs an instruction')
  })

  it('blocks device tools if evaluateSafety returns an error', async () => {
    const executeDevice = jest.fn(async () => ({ outcome: 'executed' as const, observation: 'Success' }))
    const evaluateSafety = jest.fn(async () => ({ status: 'error' as const, result: 'Blocked by user policy' }))

    const result = await executeCloudTool('device_tap', { target: '100,200' }, { executeDevice, evaluateSafety })

    expect(result.success).toBe(false)
    expect(result.output).toBe('Blocked by user policy')
    expect(executeDevice).not.toHaveBeenCalled()
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
    const evaluateSafety = jest.fn(async () => ({ status: 'success' as const, result: 'Allowed' }))
    const onToolCall = jest.fn()
    const onToolResult = jest.fn()

    const tools = buildVercelCloudTools({}, { executeDevice, evaluateSafety }, { onToolCall, onToolResult })
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

  it('executes save_user_memory and delete_user_memory via injected memory store', async () => {
    const saveMemory = jest.fn(async (_convId: string, fact: string) => `Saved: ${fact}`)
    const deleteMemory = jest.fn(async (_convId: string, fact: string) => `Deleted: ${fact}`)

    const saveResult = await executeCloudTool(
      'save_user_memory',
      { conversation_id: 'conv-1', fact: 'User likes dark mode' },
      { memoryStore: { saveMemory, deleteMemory } }
    )
    expect(saveResult.success).toBe(true)
    expect(saveResult.output).toBe('Saved: User likes dark mode')
    expect(saveMemory).toHaveBeenCalledWith('conv-1', 'User likes dark mode')

    const delResult = await executeCloudTool(
      'delete_user_memory',
      { conversation_id: 'conv-1', fact: 'User likes dark mode' },
      { memoryStore: { saveMemory, deleteMemory } }
    )
    expect(delResult.success).toBe(true)
    expect(delResult.output).toBe('Deleted: User likes dark mode')
    expect(deleteMemory).toHaveBeenCalledWith('conv-1', 'User likes dark mode')

    // Test default conversation_id fallback
    await executeCloudTool(
      'save_user_memory',
      { fact: 'User likes light mode' },
      { memoryStore: { saveMemory, deleteMemory } }
    )
    expect(saveMemory).toHaveBeenCalledWith('default', 'User likes light mode')
  })
})

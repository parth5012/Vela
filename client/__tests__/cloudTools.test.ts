import { buildCloudToolDescriptions, executeCloudTool, listCloudToolNames } from '../utils/cloudTools'

describe('cloudTools', () => {
  it('lists cloud tools without server-only entries', () => {
    const names = listCloudToolNames()

    expect(names).toContain('device_screen_read')
    expect(names).not.toContain('gmail_send_email')
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
})

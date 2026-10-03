import { buildLocalPromptBlock, buildUnavailableHint, describeToolsForPrompt } from '../utils/standalonePrompt'

describe('standalonePrompt', () => {
  it('builds a local prompt block with device tools', () => {
    const block = buildLocalPromptBlock()

    expect(block).toContain('device_screen_read')
    expect(block).not.toContain('gmail_send_email')
    expect(block).not.toContain('save_user_memory')
    expect(block).not.toContain('webview_browser')
  })

  it('honours Shizuku capability state', () => {
    expect(buildLocalPromptBlock({ hasShizuku: false })).not.toContain('device_app_install')
    expect(buildLocalPromptBlock({})).toContain('device_app_install')
  })

  it('builds an unavailable hint for server tools', () => {
    expect(buildUnavailableHint('gmail_send_email')).toContain('connect to server')
    expect(buildUnavailableHint('')).toBe('')
  })

  it('describes an empty list as empty', () => {
    expect(describeToolsForPrompt([])).toBe('')
  })
})

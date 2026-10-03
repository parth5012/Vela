import { TOOL_REGISTRY, filterAvailable, filterByMode, getTool, getUnavailableTools, isAvailable } from '../utils/toolRegistry'

describe('toolRegistry', () => {
  it('exposes a static registry with server flags', () => {
    // Arrange + Act + Assert
    expect(TOOL_REGISTRY.length).toBeGreaterThan(20)
    expect(getTool('web_search')?.requiresServer).toBe(false)
    expect(getTool('gmail_send_email')?.requiresServer).toBe(true)
    expect(getTool('run_python_code')?.requiresServer).toBe(true)
  })

  it('returns undefined for unknown or empty names', () => {
    expect(getTool('does_not_exist')).toBeUndefined()
    expect(getTool('')).toBeUndefined()
  })

  it('keeps device tools available in local and cloud', () => {
    const local = filterByMode('local').map((tool) => tool.name)
    const cloud = filterByMode('cloud').map((tool) => tool.name)

    expect(local).toContain('device_screen_read')
    expect(cloud).toContain('device_screen_read')
    expect(local).toContain('device_click')
    expect(cloud).toContain('device_tap')
  })

  it('omits server-only tools from standalone modes', () => {
    const local = filterByMode('local').map((tool) => tool.name)

    expect(local).not.toContain('gmail_send_email')
    expect(local).not.toContain('calendar_list_events')
    expect(local).not.toContain('run_python_code')
  })

  it('lists server-only tools as unavailable in standalone', () => {
    const unavailable = getUnavailableTools('local').map((tool) => tool.name)

    expect(unavailable).toContain('gmail_send_email')
    expect(getUnavailableTools('server')).toEqual([])
  })

  it('reports availability per mode', () => {
    expect(isAvailable('web_search', 'local')).toBe(true)
    expect(isAvailable('web_search', 'cloud')).toBe(true)
    expect(isAvailable('gmail_send_email', 'local')).toBe(false)
    expect(isAvailable('', 'local')).toBe(false)
  })

  it('hides not-yet-wired tools from standalone discovery but keeps them for server', () => {
    const local = filterAvailable('local').map((tool) => tool.name)

    expect(local).not.toContain('save_user_memory')
    expect(local).not.toContain('delete_user_memory')
    expect(local).not.toContain('webview_browser')
    expect(local).toContain('web_search')
    expect(local).toContain('device_screen_read')
    expect(filterAvailable('server').map((tool) => tool.name)).toContain('save_user_memory')
  })

  it('drops Shizuku tools only when Shizuku is known absent', () => {
    const without = filterAvailable('local', { hasShizuku: false }).map((tool) => tool.name)
    const unknown = filterAvailable('local', {}).map((tool) => tool.name)

    expect(without).not.toContain('device_app_install')
    expect(without).toContain('device_screen_read')
    expect(unknown).toContain('device_app_install')
  })

  it('drops web search from local only when no Tavily key (cloud keeps provider-native)', () => {
    const localNoKey = filterAvailable('local', { hasTavilyKey: false }).map((tool) => tool.name)
    const cloudNoKey = filterAvailable('cloud', { hasTavilyKey: false }).map((tool) => tool.name)

    expect(localNoKey).not.toContain('web_search')
    expect(cloudNoKey).toContain('web_search')
  })
})

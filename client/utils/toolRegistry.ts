export type ConnectionMode = 'server' | 'local' | 'cloud'

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean'
  description: string
  required?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  requiresServer: boolean
  availableInLocal: boolean
  availableInCloud: boolean
  needsApiKey?: boolean
  parameters?: Record<string, ToolParameter>
}

export interface StandaloneCapabilities {
  hasTavilyKey?: boolean
  hasShizuku?: boolean
}

const device = (
  name: string,
  description: string,
  parameters?: Record<string, ToolParameter>
): ToolDefinition => ({
  name,
  description,
  requiresServer: false,
  availableInLocal: true,
  availableInCloud: true,
  parameters,
})

const serverOnly = (name: string, description: string): ToolDefinition => ({
  name,
  description,
  requiresServer: true,
  availableInLocal: false,
  availableInCloud: false,
})

export const TOOL_REGISTRY: ToolDefinition[] = [
  serverOnly('run_python_code', 'Executes Python in a sandboxed server environment.'),
  {
    name: 'web_search',
    description: 'Search the web for up-to-date information on a query.',
    requiresServer: false,
    availableInLocal: true,
    availableInCloud: true,
    needsApiKey: true,
    parameters: { query: { type: 'string', description: 'Concise keyword query.', required: true } },
  },
  {
    name: 'save_user_memory',
    description: 'Saves a permanent fact about the user into long-term memory.',
    requiresServer: false,
    availableInLocal: true,
    availableInCloud: true,
    parameters: {
      conversation_id: { type: 'string', description: 'Active conversation id.', required: true },
      fact: { type: 'string', description: 'Single independent fact.', required: true },
    },
  },
  {
    name: 'delete_user_memory',
    description: 'Removes a fact from long-term memory.',
    requiresServer: false,
    availableInLocal: true,
    availableInCloud: true,
    parameters: {
      conversation_id: { type: 'string', description: 'Active conversation id.', required: true },
      fact: { type: 'string', description: 'Fact to forget.', required: true },
    },
  },
  serverOnly('send_status_message', 'Sends a Telegram status message via server infra.'),
  {
    name: 'webview_browser',
    description: 'Browser automation inside the client WebView (navigate/click/fill/extract).',
    requiresServer: false,
    availableInLocal: true,
    availableInCloud: true,
  },
  serverOnly('save_briefing_watch_item', 'Saves a briefing watch item via server cron.'),
  serverOnly('gmail_send_email', 'Sends Gmail via server-side OAuth.'),
  serverOnly('gmail_read_emails', 'Reads Gmail via server-side OAuth.'),
  serverOnly('calendar_list_events', 'Lists Calendar events via server-side OAuth.'),
  serverOnly('calendar_create_event', 'Creates Calendar events via server-side OAuth.'),
  device('device_screen_read', 'Reads the current screen hierarchy and visible text.'),
  device('device_tap', 'Taps an element or coordinate.', {
    target: { type: 'string', description: 'Resource id, text, or x,y.', required: true },
  }),
  device('device_click', 'Alias of device_tap for client compatibility.', {
    target: { type: 'string', description: 'Resource id, text, or x,y.', required: true },
  }),
  device('device_type', 'Types text into a focused field.'),
  device('device_scroll', 'Scrolls in a direction.'),
  device('device_swipe', 'Swipes in a direction.'),
  device('device_press_key', 'Presses a system key (BACK/HOME/ENTER).'),
  device('device_open_app', 'Opens an app by name or package.'),
  device('device_set_volume', 'Sets volume level 0-100.'),
  device('device_screenshot', 'Takes a screenshot.'),
  device('device_info', 'Battery, screen, OS info.'),
  device('device_app_permission_grant', 'Grants runtime permission via Shizuku.'),
  device('device_app_permission_revoke', 'Revokes runtime permission via Shizuku.'),
  device('device_setting_put', 'Writes system/secure/global setting via Shizuku.'),
  device('device_app_force_stop', 'Force-stops an app via Shizuku.'),
  device('device_app_set_state', 'Enables/disables an app via Shizuku.'),
  device('device_app_clear_data', 'Clears app data via Shizuku (destructive).'),
  device('device_app_install', 'Installs APK via Shizuku.'),
  device('device_app_uninstall', 'Uninstalls app via Shizuku (destructive).'),
]

export function getTool(name: string): ToolDefinition | undefined {
  if (!name) return undefined
  return TOOL_REGISTRY.find((tool) => tool.name === name)
}

export function filterByMode(mode: ConnectionMode): ToolDefinition[] {
  if (mode === 'server') return [...TOOL_REGISTRY]
  if (mode === 'local') return TOOL_REGISTRY.filter((tool) => tool.availableInLocal)
  if (mode === 'cloud') return TOOL_REGISTRY.filter((tool) => tool.availableInCloud)
  return []
}

export function getUnavailableTools(mode: ConnectionMode): ToolDefinition[] {
  if (mode === 'server') return []
  const available = new Set(filterByMode(mode).map((tool) => tool.name))
  return TOOL_REGISTRY.filter((tool) => !available.has(tool.name))
}

export function isAvailable(toolName: string, mode: ConnectionMode): boolean {
  if (!toolName) return false
  return filterByMode(mode).some((tool) => tool.name === toolName)
}

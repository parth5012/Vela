import { filterByMode } from './toolRegistry'
import { executeDeviceAction } from './deviceActionExecutor'

export interface CloudToolResult {
  success: boolean
  output: string
}

export type DeviceExecutor = typeof executeDeviceAction

export interface WebSearchFn {
  (query: string): Promise<string>
}

export interface CloudExecutorDeps {
  executeDevice?: DeviceExecutor
  webSearch?: WebSearchFn
}

export function listCloudToolNames(): string[] {
  return filterByMode('cloud').map((tool) => tool.name)
}

function isDeviceTool(toolName: string): boolean {
  return toolName.startsWith('device_')
}

export function buildCloudToolDescriptions(): Record<string, string> {
  const tools = filterByMode('cloud')
  const descriptions: Record<string, string> = {}
  for (const tool of tools) {
    descriptions[tool.name] = tool.description
  }
  return descriptions
}

export async function executeCloudTool(
  toolName: string,
  args: Record<string, string>,
  deps: CloudExecutorDeps = {}
): Promise<CloudToolResult> {
  if (!toolName) return { success: false, output: 'Unknown tool.' }
  const executeDevice = deps.executeDevice ?? executeDeviceAction

  if (isDeviceTool(toolName)) {
    const action = await executeDevice(toolName, args.target, args.value ?? args.text)
    const success = action.outcome === 'executed' || action.outcome === 'simulated'
    return { success, output: action.observation }
  }

  if (toolName === 'web_search') {
    if (!deps.webSearch) return { success: false, output: 'Web search is not configured.' }
    const output = await deps.webSearch(args.query ?? args.q ?? '').catch((error) => {
      return `Search failed: ${error?.message || String(error)}`
    })
    return { success: true, output }
  }

  if (toolName === 'webview_browser') {
    return { success: false, output: 'WebView automation runs through the WebView flow, not wired here yet.' }
  }

  if (toolName === 'save_user_memory' || toolName === 'delete_user_memory') {
    return { success: false, output: 'Local memory store is not wired yet.' }
  }

  return { success: false, output: `Unknown cloud tool "${toolName}".` }
}

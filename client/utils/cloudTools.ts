import { tool } from 'ai'
import { z } from 'zod'
import { StandaloneCapabilities, filterAvailable, isAvailable } from './toolRegistry'
import { executeDeviceAction } from './deviceActionExecutor'
import { evaluateSafety } from './safetyManager'
import { searchStandalone } from './standaloneSearch'
import { saveMemory as defaultSaveMemory, deleteMemory as defaultDeleteMemory } from '../db/memoryRepository'

export interface CloudToolResult {
  success: boolean
  output: string
}

export type DeviceExecutor = typeof executeDeviceAction
export type SafetyEvaluator = typeof evaluateSafety

export interface WebSearchFn {
  (query: string): Promise<string>
}

export interface MemoryStoreOps {
  saveMemory?: (conversationId: string, fact: string) => Promise<string>
  deleteMemory?: (conversationId: string, fact: string) => Promise<string>
}

export interface CloudExecutorDeps {
  executeDevice?: DeviceExecutor
  evaluateSafety?: SafetyEvaluator
  webSearch?: WebSearchFn
  memoryStore?: MemoryStoreOps
}

export function listCloudToolNames(caps: StandaloneCapabilities = {}): string[] {
  return filterAvailable('cloud', caps).map((tool) => tool.name)
}

function isDeviceTool(toolName: string): boolean {
  return toolName.startsWith('device_')
}

export function buildCloudToolDescriptions(caps: StandaloneCapabilities = {}): Record<string, string> {
  const tools = filterAvailable('cloud', caps)
  const descriptions: Record<string, string> = {}
  for (const tool of tools) {
    descriptions[tool.name] = tool.description
  }
  return descriptions
}

export function buildVercelCloudTools(
  caps: StandaloneCapabilities = {},
  deps: CloudExecutorDeps = {},
  callbacks?: {
    onToolCall?: (call: { toolName: string; args: any }) => void
    onToolResult?: (res: { toolName: string; result: any }) => void
  }
): Record<string, any> {
  const tools = filterAvailable('cloud', caps)
  const vercelTools: Record<string, any> = {}

  for (const t of tools) {
    const schemaObj: Record<string, z.ZodTypeAny> = {}
    if (t.parameters) {
      for (const [key, param] of Object.entries(t.parameters)) {
        let base: z.ZodTypeAny
        if (param.type === 'number') {
          base = z.number()
        } else if (param.type === 'boolean') {
          base = z.boolean()
        } else {
          base = z.string()
        }
        base = base.describe(param.description)
        if (!param.required) {
          base = base.optional()
        }
        schemaObj[key] = base
      }
    }

    const schema = z.object(schemaObj)
    vercelTools[t.name] = tool({
      description: t.description,
      inputSchema: schema,
      execute: async (args: any) => {
        callbacks?.onToolCall?.({ toolName: t.name, args })
        const res = await executeCloudTool(t.name, args || {}, deps)
        callbacks?.onToolResult?.({ toolName: t.name, result: res })
        return res.output
      },
    })
  }

  return vercelTools
}

export async function executeCloudTool(
  toolName: string,
  args: Record<string, string>,
  deps: CloudExecutorDeps = {}
): Promise<CloudToolResult> {
  if (!toolName) return { success: false, output: 'Unknown tool.' }
  if (!isAvailable(toolName, 'cloud')) return { success: false, output: `Unknown cloud tool "${toolName}".` }
  const executeDevice = deps.executeDevice ?? executeDeviceAction

  if (isDeviceTool(toolName)) {
    const safetyCheck = deps.evaluateSafety ?? evaluateSafety
    if (safetyCheck) {
      try {
        const safety = await safetyCheck(toolName, args.target, args.value ?? args.text)
        if (safety.status === 'error') {
          return { success: false, output: safety.result }
        }
      } catch (e: any) {
        return { success: false, output: `Safety evaluation failed: ${e?.message || e}` }
      }
    }
    const action = await executeDevice(toolName, args.target, args.value ?? args.text)
    const success = action.outcome === 'executed' || action.outcome === 'simulated'
    return { success, output: action.observation }
  }

  if (toolName === 'web_search') {
    const searchFn = deps.webSearch ?? ((q: string) => searchStandalone(q))
    try {
      const output = await searchFn(args.query ?? args.q ?? '')
      return { success: true, output }
    } catch (error) {
      return { success: false, output: `Search failed: ${(error as { message?: string } | undefined)?.message || String(error)}` }
    }
  }

  if (toolName === 'webview_browser') {
    return { success: false, output: 'WebView automation runs through the WebView flow, not wired here yet.' }
  }

  if (toolName === 'save_user_memory') {
    const conversationId = String(args.conversation_id || 'default')
    const fact = String(args.fact || '')
    try {
      const saveFn = deps.memoryStore?.saveMemory || defaultSaveMemory
      const output = await saveFn(conversationId, fact)
      return { success: true, output }
    } catch (err: any) {
      return { success: false, output: `Failed to save memory: ${err?.message || String(err)}` }
    }
  }

  if (toolName === 'delete_user_memory') {
    const conversationId = String(args.conversation_id || 'default')
    const fact = String(args.fact || '')
    try {
      const deleteFn = deps.memoryStore?.deleteMemory || defaultDeleteMemory
      const output = await deleteFn(conversationId, fact)
      return { success: true, output }
    } catch (err: any) {
      return { success: false, output: `Failed to delete memory: ${err?.message || String(err)}` }
    }
  }

  return { success: false, output: `Unknown cloud tool "${toolName}".` }
}

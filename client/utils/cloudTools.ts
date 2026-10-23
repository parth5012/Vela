import { tool } from 'ai'
import { z } from 'zod'
import { StandaloneCapabilities, filterAvailable, isAvailable } from './toolRegistry'
import { executeDeviceAction } from './deviceActionExecutor'
import { evaluateSafety } from './safetyManager'
import { searchStandalone } from './standaloneSearch'
import { saveMemory as defaultSaveMemory, deleteMemory as defaultDeleteMemory } from '../db/memoryRepository'
import {
  isNeedleAutomationRunning,
  runNeedleDeviceAutomation,
  type NeedleAutomationOptions,
  type NeedleAutomationResult,
} from './needleAutomation'

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
  /** Planner -> Needle bridge; injectable so tests never touch the engine. */
  runNeedleAutomation?: (
    instruction: string,
    options?: NeedleAutomationOptions
  ) => Promise<NeedleAutomationResult>
}

export function listCloudToolNames(caps: StandaloneCapabilities = {}): string[] {
  return filterAvailable('cloud', caps).map((tool) => tool.name)
}

function isDeviceTool(toolName: string): boolean {
  return toolName.startsWith('device_')
}

/** Upper bound for `max_steps`: an untrusted model must not run an unbounded loop. */
export const MAX_AUTOMATION_STEPS = 30

/**
 * Covers the window between the approval prompt and the engine swap. The
 * safety store keeps a single pending task, so two parallel delegations would
 * overwrite one approval and orphan the first call.
 */
let automationRequestInFlight = false

/** Test hook: reset the single-flight state between cases. */
export function resetAutomationRequestGuard(): void {
  automationRequestInFlight = false
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

  if (toolName === 'run_device_automation') {
    // Models sometimes emit the task as a raw call body (`args.text`) or as
    // `target`; accept those so the planner->Needle bridge is reachable even
    // when the model ignores the JSON parameter name.
    const instruction = String(args.instruction ?? args.target ?? args.text ?? '').trim()
    if (!instruction) {
      return {
        success: false,
        output: 'run_device_automation needs an instruction, e.g. "open Settings".',
      }
    }
    const rawMaxSteps = Number(args.max_steps ?? args.maxSteps)
    const requestedSteps =
      Number.isFinite(rawMaxSteps) && rawMaxSteps > 0 ? Math.floor(rawMaxSteps) : undefined
    const maxSteps = requestedSteps ? Math.min(requestedSteps, MAX_AUTOMATION_STEPS) : undefined

    if (automationRequestInFlight || isNeedleAutomationRunning()) {
      return {
        success: false,
        output: 'Another device automation is already running. Wait for it to finish before starting another.',
      }
    }

    automationRequestInFlight = true
    try {
      // Gate the delegation itself: per-step checks only see a tool name plus a
      // coordinate/ref, so the instruction's intent ("delete all photos") is lost
      // before classification. This boundary check classifies that intent once.
      const safetyCheck = deps.evaluateSafety ?? evaluateSafety
      if (safetyCheck) {
        try {
          const safety = await safetyCheck('run_device_automation', instruction)
          if (safety.status === 'error') {
            return { success: false, output: safety.result }
          }
        } catch (e: any) {
          return { success: false, output: `Safety evaluation failed: ${e?.message || e}` }
        }
      }

      const runAutomation = deps.runNeedleAutomation ?? runNeedleDeviceAutomation
      try {
        const result = await runAutomation(instruction, {
          conversationId: String(args.conversation_id || 'default'),
          ...(maxSteps ? { maxSteps } : {}),
        })
        return { success: result.ok, output: result.output }
      } catch (error: any) {
        return {
          success: false,
          output: `Device automation failed: ${error?.message || String(error)}`,
        }
      }
    } finally {
      automationRequestInFlight = false
    }
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

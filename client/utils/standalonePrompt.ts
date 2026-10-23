import { StandaloneCapabilities, ToolDefinition, filterAvailable } from './toolRegistry'

export function buildLocalPromptBlock(caps: StandaloneCapabilities = {}): string {
  return describeToolsForPrompt(filterAvailable('local', caps))
}

export function buildToolDeclarations(caps: StandaloneCapabilities = {}): string[] {
  return [buildLocalPromptBlock(caps)]
}

export function buildUnavailableHint(toolName: string): string {
  if (!toolName) return ''
  return `${toolName} is unavailable in standalone mode — connect to server for full access.`
}

/** `instruction`, `instruction?`, ... so a model knows the argument names it must emit. */
function describeParameters(tool: ToolDefinition): string {
  const entries = Object.entries(tool.parameters ?? {})
  if (entries.length === 0) return ''
  return ` (params: ${entries
    .map(([name, param]) => `${name}${param.required ? '' : '?'}: ${param.type}`)
    .join(', ')})`
}

export function describeToolsForPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return ''
  return tools.map((tool) => `${tool.name}${describeParameters(tool)} - ${tool.description}`).join('\n')
}

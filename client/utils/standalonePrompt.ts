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

export function describeToolsForPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return ''
  return tools.map((tool) => `${tool.name} - ${tool.description}`).join('\n')
}

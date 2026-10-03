import { ToolDefinition, filterByMode } from './toolRegistry'

export function buildLocalPromptBlock(): string {
  const tools = filterByMode('local')
  return tools.map((tool) => `${tool.name} - ${tool.description}`).join('\n')
}

export function buildToolDeclarations(): string[] {
  return [buildLocalPromptBlock()]
}

export function buildUnavailableHint(toolName: string): string {
  if (!toolName) return ''
  return `${toolName} is unavailable in standalone mode — connect to server for full access.`
}

export function describeToolsForPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return ''
  return tools.map((tool) => `${tool.name} - ${tool.description}`).join('\n')
}

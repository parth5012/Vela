import { executeCloudTool } from './cloudTools';
import { isAvailable } from './toolRegistry';
import { buildUnavailableHint } from './standalonePrompt';
import { parseToolCall } from './localAgentLoop';

function generateLocalRequestId(): string {
  return 'req_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
}

/**
 * Invokes one tool and returns the text to show to the model/user.
 * Standalone (local/cloud) tools run in-process; server tools go through the
 * backend proxy when an API URL is configured.
 */
async function dispatchTool(
  toolName: string,
  parsedArgs: Record<string, any>,
  threadId: string,
  apiUrl?: string,
  apiKey?: string,
  connectionMode: 'server' | 'local' | 'cloud' = 'server'
): Promise<string> {
  let responseText = '';

  // Standalone / client execution path (local or cloud modes, or when no server API URL)
  if (connectionMode !== 'server' || !apiUrl) {
    const mode = connectionMode === 'cloud' ? 'cloud' : 'local';
    if (isAvailable(toolName, mode) || isAvailable(toolName, 'local')) {
      const res = await executeCloudTool(toolName, { ...parsedArgs, conversation_id: threadId });
      responseText = res.output;
    } else if (isAvailable(toolName, 'server')) {
      responseText = buildUnavailableHint(toolName);
    } else {
      responseText = `Error: Unknown tool "${toolName}".`;
    }
    return responseText;
  }

  const requestId = generateLocalRequestId();
  try {
    const response = await fetch(`${apiUrl}/api/tools/invoke`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: threadId,
        tool_name: toolName,
        arguments: parsedArgs,
        request_id: requestId,
      }),
    });

    if (!response.ok) {
      responseText = `Error: Tool execution failed with status ${response.status}`;
    } else {
      const data = await response.json();
      if (data.status === 'error') {
        responseText = `Error: ${data.error?.message || 'Tool execution failed'}`;
      } else {
        responseText = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
      }
    }
  } catch (error: any) {
    console.error(`Error invoking tool ${toolName}:`, error);
    responseText = `Error: ${error?.message || 'Network error invoking tool proxy'}`;
  }
  return responseText;
}

/**
 * Detects and runs a Needle (.cact) JSON tool call.
 *
 * Needle declares its tools natively (tools_json at init) and answers with
 * `{type:'call', function_calls:[{name, arguments}], confidence}` — or the flat
 * `{name, arguments}` mock shape — never the `<call>` XML the compiled prompt
 * asks GGUF/LiteRT models for (#295). Without this branch the call renders as
 * plain assistant text and no device action is ever executed. Parsing reuses
 * `parseToolCall` so the two paths cannot drift; it also maps `app`/`level`/
 * `key`/`text` arguments onto the executor's target/value slots.
 *
 * A refusal envelope (`function_calls: []`) and JSON that is not a tool call
 * (e.g. echoed schemas) return `null` — nothing is executed.
 */
function readNeedleToolCall(
  content: string
): { toolName: string; args: Record<string, any>; raw: string } | null {
  const call = parseToolCall(content);
  if (!call || !call.toolName) return null;

  const args: Record<string, any> = { ...(call.arguments || {}) };
  if (call.target !== undefined) args.target = call.target;
  if (call.value !== undefined) args.value = call.value;

  return { toolName: call.toolName, args, raw: call.raw };
}

export async function parseAndExecuteTools(
  content: string,
  threadId: string,
  apiUrl?: string,
  apiKey?: string,
  connectionMode: 'server' | 'local' | 'cloud' = 'server'
): Promise<{ hasInvocations: boolean; updatedContent: string }> {
  // Regex to match call blocks: <call name="tool_name">JSON_ARGS</call>
  const callRegex = /<call name="([^"]+)">([\s\S]*?)<\/call>/g;
  
  let match;
  let updatedContent = content;
  let hasInvocations = false;
  
  // Collect all matches to avoid regex index mutation issues while editing string
  const callBlocks: { fullMatch: string; toolName: string; rawArgs: string }[] = [];
  
  // Use a clean loop to extract all calls first
  callRegex.lastIndex = 0;
  while ((match = callRegex.exec(content)) !== null) {
    callBlocks.push({
      fullMatch: match[0],
      toolName: match[1],
      rawArgs: match[2],
    });
  }

  if (callBlocks.length > 0) {
    hasInvocations = true;
  }

  for (const block of callBlocks) {
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(block.rawArgs.trim());
    } catch (e) {
      console.warn(`Failed to parse arguments for tool ${block.toolName}:`, e);
    }

    const responseText = await dispatchTool(
      block.toolName,
      parsedArgs,
      threadId,
      apiUrl,
      apiKey,
      connectionMode
    );

    const responseBlock = `<response name="${block.toolName}">\n${responseText}\n</response>`;
    // Insert response block immediately after the matching call block
    updatedContent = updatedContent.replace(block.fullMatch, `${block.fullMatch}\n${responseBlock}`);
  }

  // No XML call: a Needle engine may have answered with its JSON envelope.
  // Only local mode runs Needle, so server/cloud prose containing JSON is left
  // untouched (the backend has its own tool protocol).
  if (!hasInvocations && connectionMode === 'local') {
    const needleCall = readNeedleToolCall(content);
    if (needleCall) {
      const responseText = await dispatchTool(
        needleCall.toolName,
        needleCall.args,
        threadId,
        apiUrl,
        apiKey,
        connectionMode
      );
      updatedContent = updatedContent.replace(
        needleCall.raw,
        `${needleCall.raw}\n<response name="${needleCall.toolName}">\n${responseText}\n</response>`
      );
      hasInvocations = true;
    }
  }

  return {
    hasInvocations,
    updatedContent,
  };
}

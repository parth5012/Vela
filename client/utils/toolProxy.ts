function generateLocalRequestId(): string {
  return 'req_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
}

export async function parseAndExecuteTools(
  content: string,
  threadId: string,
  apiUrl: string,
  apiKey: string
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

    const requestId = generateLocalRequestId();
    let responseText = '';

    try {
      const response = await fetch(`${apiUrl}/api/tools/invoke`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          conversation_id: threadId,
          tool_name: block.toolName,
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
      console.error(`Error invoking tool ${block.toolName}:`, error);
      responseText = `Error: ${error?.message || 'Network error invoking tool proxy'}`;
    }

    const responseBlock = `<response name="${block.toolName}">\n${responseText}\n</response>`;
    // Insert response block immediately after the matching call block
    updatedContent = updatedContent.replace(block.fullMatch, `${block.fullMatch}\n${responseBlock}`);
  }

  return {
    hasInvocations,
    updatedContent,
  };
}

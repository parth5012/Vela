import asyncio
from langchain_core.tools import tool
from utils.logger import StructuredLogger

logger = StructuredLogger("WebViewBrowserTool")

# Registry to hold event and response for active webview automation calls
# Key: conversation_id (string)
# Value: dict with "event": asyncio.Event, "response": dict
PENDING_TASKS = {}

@tool
async def webview_browser(conversation_id: str, action: str, target: str = None, value: str = None) -> str:
    """Executes a browser automation command inside the client's WebView.
    
    Use this tool to navigate web pages, search Google, extract content, click buttons, or fill text inputs.
    It triggers the action locally inside the user's mobile app client and waits for the result.
    
    Args:
        conversation_id: The active conversation UUID (available in the system prompt metadata).
        action: The browser action to perform. Supported values:
            - 'navigate': Loads a URL (requires 'value' as the target URL).
            - 'click': Clicks a DOM element (requires 'target' as CSS selector or reference ID like '@e0').
            - 'fill': Clears and types text into an input field (requires 'target' as selector/ref ID and 'value' as text).
            - 'extract_dom': Scrapes the current page and returns a minified, token-optimized interactive JSON representation.
        target: The target CSS selector or reference element ID (e.g. '@e3') for actions like 'click' or 'fill'.
        value: The value payload (URL for 'navigate', text string for 'fill').
        
    Returns:
        The result of the browser action (such as minified page JSON or operation confirmation).
    """
    logger.info("WebView browser tool triggered", conversation_id=conversation_id, action=action, target=target, value=value)
    
    event = asyncio.Event()
    PENDING_TASKS[conversation_id] = {
        "event": event,
        "response": None
    }
    
    try:
        # Wait up to 60 seconds for the mobile client to process and post the response
        await asyncio.wait_for(event.wait(), timeout=60.0)
        task_data = PENDING_TASKS.get(conversation_id)
        if task_data and task_data["response"]:
            resp = task_data["response"]
            status = resp.get("status", "error")
            result = resp.get("result", "")
            if status == "success":
                return result
            else:
                return f"Error executing browser action: {result}"
        else:
            return "Error: No response received from the client WebView."
    except asyncio.TimeoutError:
        logger.error("Timeout waiting for WebView response", conversation_id=conversation_id)
        return "Error: Timeout waiting for client WebView response. Make sure the Vela app has the browser tab open."
    finally:
        PENDING_TASKS.pop(conversation_id, None)

import asyncio
from typing import Optional
from utils.logger import StructuredLogger

logger = StructuredLogger("PendingTasksHelper")

# Registry to hold event and response for active client automation calls
# Key: conversation_id (string) or f"{conversation_id}_{task_token}"
# Value: dict with "event": asyncio.Event, "response": dict
PENDING_TASKS = {}
LAST_TOOL_START_TOKENS = {}

async def wait_for_client_event(
    conversation_id: str,
    action: Optional[str] = None,
    target: Optional[str] = None,
    value: Optional[str] = None,
    task_token: Optional[str] = None,
    timeout: float = 60.0,
    timeout_message: str = "Timeout waiting for client response."
):
    """Blocks execution and awaits an event response from the mobile client."""
    event = asyncio.Event()
    key = f"{conversation_id}_{task_token}" if task_token else conversation_id
    
    PENDING_TASKS[key] = {
        "event": event,
        "response": None
    }
    
    status = "error"
    result = ""
    try:
        # Wait for mobile client to process and post response
        await asyncio.wait_for(event.wait(), timeout=timeout)
        task_data = PENDING_TASKS.get(key)
        if task_data and task_data["response"]:
            resp = task_data["response"]
            status = resp.get("status", "error")
            result = resp.get("result", "")
        else:
            result = "No response received from client."
    except asyncio.TimeoutError:
        status = "timeout"
        result = timeout_message
    finally:
        PENDING_TASKS.pop(key, None)
        
    return status, result

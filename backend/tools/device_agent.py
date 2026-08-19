import asyncio
from langchain_core.tools import tool
from tools.pending_tasks import wait_for_client_event

@tool
async def device_screen_read(conversation_id: str) -> str:
    """Reads the current hierarchy of elements and text visible on the device screen.
    
    Args:
        conversation_id: The active conversation UUID.
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="screen_read",
        target=None,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_tap(conversation_id: str, target: str) -> str:
    """Taps on a specific element or coordinate on the screen.
    
    Args:
        conversation_id: The active conversation UUID.
        target: Resource ID, element text, or coordinates (e.g. "500,1000") to tap.
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="tap",
        target=target,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_type(conversation_id: str, target: str, value: str) -> str:
    """Types text into a focused field or specific target element on the device.
    
    Args:
        conversation_id: The active conversation UUID.
        target: Resource ID, element description, or target input field.
        value: The text string to type.
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="type",
        target=target,
        value=value
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_scroll(conversation_id: str, direction: str) -> str:
    """Scrolls the screen in a specified direction.
    
    Args:
        conversation_id: The active conversation UUID.
        direction: Direction to scroll ('up', 'down', 'left', 'right').
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="scroll",
        target=direction,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_swipe(conversation_id: str, direction: str) -> str:
    """Swipes in the specified direction on the screen.
    
    Args:
        conversation_id: The active conversation UUID.
        direction: The direction of the swipe ('up', 'down', 'left', 'right').
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="swipe",
        target=direction,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_press_key(conversation_id: str, key_name: str) -> str:
    """Presses a system or hardware key on the device.
    
    Args:
        conversation_id: The active conversation UUID.
        key_name: Key to press (e.g. 'BACK', 'HOME', 'RECENTS', 'ENTER').
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="press_key",
        target=key_name,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_open_app(conversation_id: str, app_name: str) -> str:
    """Opens an app on the device by its name or package identifier.
    
    Args:
        conversation_id: The active conversation UUID.
        app_name: Name or package name of the app to open.
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="open_app",
        target=app_name,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_set_volume(conversation_id: str, level: int) -> str:
    """Sets the device volume to a specified level.
    
    Args:
        conversation_id: The active conversation UUID.
        level: Volume level percentage (0 to 100).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="set_volume",
        target=str(level),
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_screenshot(conversation_id: str) -> str:
    """Takes a screenshot of the current screen.
    
    Args:
        conversation_id: The active conversation UUID.
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="screenshot",
        target=None,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_info(conversation_id: str) -> str:
    """Retrieves battery status, screen dimensions, OS version, and other system info.
    
    Args:
        conversation_id: The active conversation UUID.
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="info",
        target=None,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

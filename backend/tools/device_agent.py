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

# --- Shizuku allowlisted privileged operations -----------------------------
# These eight tools are the complete privileged surface (see
# docs/shizuku-integration.md). They require the Shizuku server to be running
# and permission granted in the Vela client; otherwise the client answers with
# a "not ready" error that is returned to the agent verbatim.

@tool
async def device_app_permission_grant(conversation_id: str, package: str, permission: str) -> str:
    """Grants a runtime permission to an app via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        package: Target package name (e.g. com.example.app).
        permission: Full permission name (e.g. android.permission.CAMERA).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="app_permission_grant",
        target=package,
        value=permission
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_app_permission_revoke(conversation_id: str, package: str, permission: str) -> str:
    """Revokes a runtime permission from an app via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        package: Target package name (e.g. com.example.app).
        permission: Full permission name (e.g. android.permission.CAMERA).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="app_permission_revoke",
        target=package,
        value=permission
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_setting_put(conversation_id: str, namespace: str, key: str, value: str) -> str:
    """Writes a system/secure/global setting via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        namespace: One of: system, secure, global.
        key: Setting key (e.g. font_scale).
        value: New value (e.g. 1.2).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="setting_put",
        target=f"{namespace}/{key}",
        value=value
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_app_force_stop(conversation_id: str, package: str) -> str:
    """Force-stops a running app via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        package: Target package name (e.g. com.example.app).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="app_force_stop",
        target=package,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_app_set_state(conversation_id: str, package: str, state: str) -> str:
    """Enables or disables an app's components via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        package: Target package name (e.g. com.example.app).
        state: Either 'enabled' or 'disabled'.
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="app_set_state",
        target=package,
        value=state
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_app_clear_data(conversation_id: str, package: str) -> str:
    """Clears an app's data (destructive) via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        package: Target package name (e.g. com.example.app).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="app_clear_data",
        target=package,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_app_install(conversation_id: str, apk_path: str) -> str:
    """Installs an APK from device storage via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        apk_path: Absolute path to the APK on the device (e.g. /sdcard/Download/app.apk).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="app_install",
        target=apk_path,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

@tool
async def device_app_uninstall(conversation_id: str, package: str) -> str:
    """Uninstalls an app (destructive) via Shizuku (requires Shizuku permission granted).

    Args:
        conversation_id: The active conversation UUID.
        package: Target package name (e.g. com.example.app).
    """
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action="app_uninstall",
        target=package,
        value=None
    )
    if status == "success":
        return result
    else:
        return f"Error executing device action: {result}"

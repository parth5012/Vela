"""Shizuku allowlisted device tools: contract tests (TDD red phase)."""

from unittest.mock import AsyncMock, patch

import pytest

from tools.device_agent import (
    device_app_clear_data,
    device_app_force_stop,
    device_app_install,
    device_app_permission_grant,
    device_app_permission_revoke,
    device_app_set_state,
    device_app_uninstall,
    device_setting_put,
)

CONV_ID = "test-conv-123"


@pytest.mark.asyncio
@patch("tools.device_agent.wait_for_client_event", new_callable=AsyncMock)
async def test_shizuku_tools_forward_args_as_target_value(mock_wait):
    mock_wait.return_value = ("success", "Operation completed successfully")

    res = await device_app_permission_grant.coroutine(CONV_ID, "com.a", "android.permission.CAMERA")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID,
        action="app_permission_grant",
        target="com.a",
        value="android.permission.CAMERA",
    )

    res = await device_app_permission_revoke.coroutine(CONV_ID, "com.a", "android.permission.CAMERA")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID,
        action="app_permission_revoke",
        target="com.a",
        value="android.permission.CAMERA",
    )

    res = await device_setting_put.coroutine(CONV_ID, "secure", "font_scale", "1.2")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID,
        action="setting_put",
        target="secure/font_scale",
        value="1.2",
    )

    res = await device_app_force_stop.coroutine(CONV_ID, "com.a")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID, action="app_force_stop", target="com.a", value=None
    )

    res = await device_app_set_state.coroutine(CONV_ID, "com.a", "disabled")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID, action="app_set_state", target="com.a", value="disabled"
    )

    res = await device_app_clear_data.coroutine(CONV_ID, "com.a")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID, action="app_clear_data", target="com.a", value=None
    )

    res = await device_app_install.coroutine(CONV_ID, "/sdcard/Download/app.apk")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID,
        action="app_install",
        target="/sdcard/Download/app.apk",
        value=None,
    )

    res = await device_app_uninstall.coroutine(CONV_ID, "com.a")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(
        conversation_id=CONV_ID, action="app_uninstall", target="com.a", value=None
    )


@pytest.mark.asyncio
@patch("tools.device_agent.wait_for_client_event", new_callable=AsyncMock)
async def test_shizuku_tools_report_client_failure(mock_wait):
    mock_wait.return_value = ("error", "Shizuku is not ready")

    res = await device_app_force_stop.coroutine(CONV_ID, "com.a")
    assert res == "Error executing device action: Shizuku is not ready"


def test_shizuku_tools_registered_in_tools_list():
    from tools import tools_list

    names = {t.name for t in tools_list}
    expected = {
        "device_app_permission_grant",
        "device_app_permission_revoke",
        "device_setting_put",
        "device_app_force_stop",
        "device_app_set_state",
        "device_app_clear_data",
        "device_app_install",
        "device_app_uninstall",
    }
    assert expected <= names, f"missing tools: {expected - names}"


def test_shizuku_tools_bound_to_device_agent():
    from agent.registry import AGENT_REGISTRY

    cfg = AGENT_REGISTRY.get("device_agent")
    assert cfg is not None, "device_agent registry entry missing"
    tool_names = set(cfg.tool_names)
    expected = {
        "device_app_permission_grant",
        "device_app_permission_revoke",
        "device_setting_put",
        "device_app_force_stop",
        "device_app_set_state",
        "device_app_clear_data",
        "device_app_install",
        "device_app_uninstall",
    }
    assert expected <= tool_names, f"missing bindings: {expected - tool_names}"

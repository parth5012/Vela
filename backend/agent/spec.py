"""Spec-first registries for backend agent tools and SSE event schemas.

Enforces typed, drift-resistant contracts for:
1. SSE event schemas emitted by /chat/message streaming generator
2. Agent tools registered, wired into LangGraph, and exposed to agents
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from tools.calendar import calendar_create_event, calendar_list_events
from tools.code_exec import run_python_code
from tools.device_agent import (
    device_app_clear_data,
    device_app_force_stop,
    device_app_install,
    device_app_permission_grant,
    device_app_permission_revoke,
    device_app_set_state,
    device_app_uninstall,
    device_info,
    device_open_app,
    device_press_key,
    device_screen_read,
    device_screenshot,
    device_scroll,
    device_set_volume,
    device_setting_put,
    device_swipe,
    device_tap,
    device_type,
)
from tools.gmail import gmail_read_emails, gmail_send_email
from tools.memory import delete_user_memory, save_user_memory
from tools.notify import save_briefing_watch_item
from tools.status_update import send_status_message
from tools.web_search import web_search
from tools.webview_browser import webview_browser


# ---------------------------------------------------------------------------
# 1. SSE Event Schemas & Registry
# ---------------------------------------------------------------------------


class ContentSSEEvent(BaseModel):
    """Event emitted for token streaming, tool call start tag, and tool call end tag."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["content"] = "content"
    delta: str
    role: str | None = None
    message_id: str | None = None


class DoneSSEEvent(BaseModel):
    """Terminal event emitted when a chat turn completes successfully."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["done"] = "done"
    thread_title: str = Field(min_length=1)
    agent: str | None = None
    persona: str | None = None
    message_id: str | None = None


class ErrorSSEEvent(BaseModel):
    """Event emitted when an unhandled error occurs during stream execution."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["error"] = "error"
    message: str


class ThreadStoppedSSEEvent(BaseModel):
    """Event emitted when a stream is cancelled or preempted by another request."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["thread_stopped"] = "thread_stopped"
    thread_id: str


class AuthRequiredSSEEvent(BaseModel):
    """Event emitted when a tool invocation detects missing authorization."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["auth_required"] = "auth_required"
    provider: str


class ToolCallSSEEvent(BaseModel):
    """Optional structured event for tool call payloads."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["tool_call"] = "tool_call"
    tool_name: str | None = None
    tool_input: dict[str, Any] | str | None = None
    tool_output: Any = None
    tool_calls: list[dict[str, Any]] | None = None


SSE_EVENTS: dict[str, type[BaseModel]] = {
    "content": ContentSSEEvent,
    "done": DoneSSEEvent,
    "error": ErrorSSEEvent,
    "thread_stopped": ThreadStoppedSSEEvent,
    "auth_required": AuthRequiredSSEEvent,
    "tool_call": ToolCallSSEEvent,
}


def validate_sse_event(event_data: dict[str, Any]) -> BaseModel:
    """Validate a parsed dictionary against the SSE_EVENTS registry.

    Raises:
        ValueError: If event_data is not a dict or 'type' is unknown/missing.
        ValidationError: If required fields are missing or types are invalid.
    """
    if not isinstance(event_data, dict):
        raise ValueError(f"Expected dict for event data, got {type(event_data).__name__}")

    event_type = event_data.get("type")
    if not event_type:
        raise ValueError("Missing required 'type' field in SSE event data")

    model_cls = SSE_EVENTS.get(event_type)
    if model_cls is None:
        raise ValueError(
            f"Unknown SSE event type: {event_type!r}. "
            f"Registered event types: {sorted(SSE_EVENTS.keys())}"
        )

    return model_cls.model_validate(event_data)


def validate_sse_line(line: str) -> BaseModel:
    """Parse and validate an SSE line (e.g. 'data: {...}\\n\\n') against SSE_EVENTS.

    Raises:
        ValueError: If line is empty, comment, malformed, or missing 'data:' prefix.
        ValidationError: If JSON payload violates the matching Pydantic model.
    """
    cleaned = line.strip()
    if not cleaned:
        raise ValueError("Empty SSE line")

    if cleaned.startswith(":"):
        raise ValueError(f"SSE comment line is not an event: {line!r}")

    if cleaned.startswith("data:"):
        payload = cleaned[5:].strip()
    elif cleaned.startswith("{") and cleaned.endswith("}"):
        payload = cleaned
    else:
        raise ValueError(f"Malformed SSE line (expected 'data: ...'): {line!r}")

    if not payload:
        raise ValueError("Empty data payload in SSE line")

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed JSON in SSE line: {exc}") from exc

    return validate_sse_event(data)


# ---------------------------------------------------------------------------
# 2. Agent Tool Specs & Registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolSpec:
    """Metadata specification for a backend agent tool."""

    name: str
    description: str
    args_schema: type[BaseModel] | None
    source_tool: BaseTool

    @property
    def input_schema(self) -> type[BaseModel] | None:
        """Alias for args_schema."""
        return self.args_schema


# Canonical list of tools that must be registered and wired
_REGISTERED_TOOLS: list[BaseTool] = [
    run_python_code,
    web_search,
    save_user_memory,
    delete_user_memory,
    send_status_message,
    webview_browser,
    save_briefing_watch_item,
    gmail_send_email,
    gmail_read_emails,
    calendar_list_events,
    calendar_create_event,
    device_screen_read,
    device_tap,
    device_type,
    device_scroll,
    device_swipe,
    device_press_key,
    device_open_app,
    device_set_volume,
    device_screenshot,
    device_info,
    device_app_permission_grant,
    device_app_permission_revoke,
    device_setting_put,
    device_app_force_stop,
    device_app_set_state,
    device_app_clear_data,
    device_app_install,
    device_app_uninstall,
]


def _build_tool_specs(tools: list[BaseTool]) -> dict[str, ToolSpec]:
    specs: dict[str, ToolSpec] = {}
    for tool in tools:
        spec = ToolSpec(
            name=tool.name,
            description=tool.description,
            args_schema=getattr(tool, "args_schema", None),
            source_tool=tool,
        )
        specs[tool.name] = spec
    return specs


TOOL_SPECS: dict[str, ToolSpec] = _build_tool_specs(_REGISTERED_TOOLS)


def get_registered_tools() -> list[BaseTool]:
    """Return all source tool instances from the tool spec registry."""
    return [spec.source_tool for spec in TOOL_SPECS.values()]


def get_tool_spec(name: str) -> ToolSpec | None:
    """Return ToolSpec for a given tool name, or None if not found."""
    return TOOL_SPECS.get(name)

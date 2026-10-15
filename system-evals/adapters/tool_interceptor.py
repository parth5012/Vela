"""Tool interception seam for system evaluation.

Intercepts tool execution during agent evaluation to capture tool calls,
verify schemas, and provide deterministic mock responses without external side-effects.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class ToolCallRecord:
    """Record of a tool invocation observed during an eval turn."""
    tool_name: str
    arguments: dict[str, Any]
    call_index: int = 0
    return_value: Any = None


class MockToolInterceptor:
    """Seam that mocks tool endpoints while recording LLM arguments."""

    def __init__(self):
        self.recorded_calls: list[ToolCallRecord] = []
        self._handlers: dict[str, Callable[[dict[str, Any]], Any]] = {}
        self._setup_default_handlers()

    def register_handler(self, tool_name: str, handler: Callable[[dict[str, Any]], Any]) -> None:
        self._handlers[tool_name] = handler

    def handle_call(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        index = len(self.recorded_calls)
        handler = self._handlers.get(tool_name)
        if handler:
            result = handler(arguments)
        else:
            result = {"status": "success", "mock": True, "tool": tool_name}

        record = ToolCallRecord(
            tool_name=tool_name,
            arguments=arguments,
            call_index=index,
            return_value=result,
        )
        self.recorded_calls.append(record)
        return result

    def clear(self) -> None:
        self.recorded_calls.clear()

    def get_calls_for_tool(self, tool_name: str) -> list[ToolCallRecord]:
        return [c for c in self.recorded_calls if c.tool_name == tool_name]

    def _setup_default_handlers(self) -> None:
        self._handlers["gmail_read_emails"] = lambda args: [
            {"id": "msg_001", "from": "priya@example.com", "subject": "Q3 Review Sync", "snippet": "Can we sync on Friday?"},
            {"id": "msg_002", "from": "alerts@linear.app", "subject": "Issue VELA-102 assigned", "snippet": "Bug reported in auth gate."},
        ]
        self._handlers["gmail_send_email"] = lambda args: {
            "status": "sent",
            "message_id": "sent_msg_999",
            "recipient": args.get("recipient") or args.get("to"),
        }
        self._handlers["calendar_list_events"] = lambda args: [
            {"id": "evt_101", "summary": "Team Standup", "start": "2026-10-15T09:30:00Z", "end": "2026-10-15T10:00:00Z"},
            {"id": "evt_102", "summary": "Product Review", "start": "2026-10-15T14:00:00Z", "end": "2026-10-15T15:00:00Z"},
        ]
        self._handlers["calendar_create_event"] = lambda args: {
            "status": "confirmed",
            "event_id": "evt_new_555",
            "summary": args.get("summary"),
            "start": args.get("start"),
        }
        self._handlers["device_agent"] = lambda args: {
            "status": "executed",
            "action": args.get("action"),
            "target": args.get("target"),
        }
        self._handlers["web_search"] = lambda args: [
            {"title": "Search Result 1", "url": "https://example.com/1", "snippet": "Accurate verified summary."},
            {"title": "Search Result 2", "url": "https://example.com/2", "snippet": "Additional context details."},
        ]

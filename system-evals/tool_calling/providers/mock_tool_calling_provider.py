"""Simulated tool-calling agent provider for offline evaluation."""

from __future__ import annotations

import json
from typing import Any
from adapters.client import TurnResult


class MockToolCallingEngine:
    """In-memory engine simulating Vela tool selection/arguments for offline evals."""

    def __init__(self):
        self._calls: list[dict[str, Any]] = []

    def reset(self) -> None:
        self._calls.clear()

    def send_turn(
        self,
        message: str,
        persona: str = "personal assistant",
        thread_id: str | None = None,
        case: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> TurnResult:
        case = case or {}
        expected_tools = case.get("expected_tools")
        if expected_tools is None:
            et = case.get("expected_tool")
            expected_tools = [et] if et else []
        expected_tools = [t for t in expected_tools if t]

        expected_args = case.get("expected_arguments") or {}
        should_call = case.get("should_call_tool", len(expected_tools) > 0)

        tool_calls: list[dict[str, Any]] = []
        self._calls.append({"message": message, "persona": persona, "thread_id": thread_id})
        if should_call:
            for tool_name in expected_tools:
                args = dict(expected_args) if expected_args else {}
                tool_calls.append({"tool": tool_name, "input": args, "body": "dry_run_intercepted"})
        else:
            tool_calls = []

        # Build a textual representation with <call:...> tags
        parts = []
        for tc in tool_calls:
            inp = json.dumps(tc["input"])
            parts.append(f'<call:{tc["tool"]} input="{inp}">dry_run_intercepted</call:{tc["tool"]}>')
        text = " ".join(parts) if parts else "No tool needed; answering directly."

        return TurnResult(
            text=text,
            tool_calls=tool_calls,
            status_code=200,
            is_success=True,
            latency_ms=10.0,
        )


def get_mock_engine() -> MockToolCallingEngine:
    return MockToolCallingEngine()

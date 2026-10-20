"""Mock Workspace Provider for deterministic offline evaluation.

Simulates agent reasoning and tool calling against the SimulatedWorkspace state machine.
"""

from __future__ import annotations

import json
from typing import Any
from ..workspace_state import SimulatedWorkspace


class MockWorkspaceProvider:
    """Produces deterministic workspace tool sequences and responses for test cases."""

    def __init__(self, workspace: SimulatedWorkspace | None = None):
        self.workspace = workspace or SimulatedWorkspace()

    def process_turn(self, case: dict[str, Any]) -> dict[str, Any]:
        """Produce deterministic tool calls and response text for a workspace flow."""
        self.workspace.reset()

        if case.get("requires_confirmation", False):
            # Destructive action requested -> model must ask for confirmation or refuse
            return {
                "text": "Are you sure you want to proceed? This is a destructive action and cannot be undone without confirmation.",
                "tool_calls": [],
                "is_success": True,
            }

        expected_sequence = case.get("expected_sequence", [])
        expected_arguments = case.get("expected_arguments", {})
        tool_calls: list[dict[str, Any]] = []
        turn_logs: list[str] = []

        for tool_name in expected_sequence:
            args = expected_arguments.get(tool_name, {})
            # Execute tool in simulated workspace
            res = self.workspace.execute_tool(tool_name, args)
            tool_calls.append({
                "tool": tool_name,
                "name": tool_name,
                "args": dict(args),
                "input": dict(args),
                "result": res,
            })
            turn_logs.append(f"Executed {tool_name} successfully.")

        response_text = " ".join(turn_logs) if turn_logs else "Completed workspace task."
        return {
            "text": response_text,
            "tool_calls": tool_calls,
            "is_success": True,
        }

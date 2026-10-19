"""Deterministic Mock Provider for Phone Automation Evaluations.

Bridges user instructions into simulated device action tool calls
without contacting physical devices or live networks.
"""

from __future__ import annotations

import json
from typing import Any
from ..device_state import SimulatedDeviceState, assert_hardware_safety_guard


class MockPhoneProvider:
    """Simulates device agent model responses for phone automation test cases."""

    def __init__(self, state: SimulatedDeviceState | None = None):
        self.state = state or SimulatedDeviceState()

    def process_turn(self, case: dict[str, Any]) -> dict[str, Any]:
        """Produce deterministic tool call output corresponding to test case intent."""
        assert_hardware_safety_guard()

        expected_action = case.get("expected_action")
        expected_params = case.get("expected_params", {})

        # If case expects refusal or error (e.g. shizuku denied or safety violation)
        if case.get("expect_refusal"):
            return {
                "text": "Refused: Operation violates hardware safety or privilege policies.",
                "tool_calls": [],
                "is_success": True,
            }

        tool_calls = []
        if expected_action:
            tool_calls.append({
                "tool": expected_action,
                "args": dict(expected_params),
            })

            # Execute against simulated state machine
            exec_res = self.state.execute_action(expected_action, expected_params)
            res_text = f"Executed {expected_action} with {expected_params}: {exec_res.get('result')}"
        else:
            res_text = case.get("expected_response", "Processed query successfully.")

        # If OCR screen reading evaluation, include extracted text
        if case.get("mock_screen_nodes"):
            extracted = " ".join([node.get("text", "") for node in case["mock_screen_nodes"] if node.get("text")])
            res_text = f"Screen contents: {extracted}"

        return {
            "text": res_text,
            "tool_calls": tool_calls,
            "is_success": True,
        }

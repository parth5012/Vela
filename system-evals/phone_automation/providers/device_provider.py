"""Custom Promptfoo Python provider for phone automation device agent."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

base_dir = Path(__file__).resolve().parent.parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from phone_automation.device_state import SimulatedDeviceState, assert_hardware_safety_guard
from phone_automation.providers.mock_phone_provider import MockPhoneProvider
from adapters.client import VelaClient

_device_state = SimulatedDeviceState()
_mock_provider = MockPhoneProvider(_device_state)


def call_device_agent(
    prompt: str,
    options: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute device agent query with hardware safety guard.
    
    If live execution is requested via context/options, invokes VelaClient (failing closed
    if live backend is unreachable). Otherwise uses SimulatedDeviceState.
    """
    assert_hardware_safety_guard()
    options = options or {}
    context = context or {}

    live = options.get("live", False) or context.get("vars", {}).get("live", False)

    if live:
        client = VelaClient()
        result = client.send_turn(message=prompt, persona="device_agent")
        if not result.is_success:
            return {"error": result.error_message or "Request failed", "tool_calls": []}
        return {
            "output": result.text,
            "tool_calls": result.tool_calls,
            "latencyMs": result.latency_ms,
        }

    # Deterministic mock/simulated execution
    # Attempt to locate matching case from datasets if possible
    from phone_automation.datasets import load_phone_cases
    cases = load_phone_cases(mode="nightly")
    matched_case = next((c for c in cases if c.get("prompt") == prompt), None)

    if matched_case:
        res = _mock_provider.process_turn(matched_case)
        return {
            "output": res["text"],
            "tool_calls": res["tool_calls"],
            "latencyMs": 15,
        }

    # Fallback generic mapping
    return {
        "output": f"Processed: {prompt}",
        "tool_calls": [],
        "latencyMs": 10,
    }

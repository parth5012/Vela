"""Custom Promptfoo Python provider for phone automation device agent."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

base_dir = Path(__file__).resolve().parent.parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from functools import lru_cache
from phone_automation.device_state import SimulatedDeviceState, assert_hardware_safety_guard
from phone_automation.providers.mock_phone_provider import MockPhoneProvider
from adapters.client import VelaClient


@lru_cache(maxsize=4)
def _get_cached_cases(mode: str) -> list[dict[str, Any]]:
    from phone_automation.datasets import load_phone_cases
    return load_phone_cases(mode=mode)


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

    # Deterministic mock/simulated execution with isolated state per invocation
    mode = options.get("mode") or context.get("vars", {}).get("mode", "nightly")
    cases = _get_cached_cases(mode)
    matched_case = next((c for c in cases if c.get("prompt") == prompt), None)

    mock_provider = MockPhoneProvider(SimulatedDeviceState())

    if matched_case:
        res = mock_provider.process_turn(matched_case)
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

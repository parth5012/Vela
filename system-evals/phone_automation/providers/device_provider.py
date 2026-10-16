"""Custom Promptfoo Python provider for phone automation device agent."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

base_dir = Path(__file__).resolve().parent.parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from adapters.client import VelaClient

def call_device_agent(prompt: str, options: dict[str, Any] | None = None, context: dict[str, Any] | None = None) -> dict[str, Any]:
    client = VelaClient()
    result = client.send_turn(message=prompt, persona="personal assistant")
    if not result.is_success:
        return {"error": result.error_message or "Request failed"}
    return {
        "output": result.text,
        "tool_calls": result.tool_calls,
        "latencyMs": result.latency_ms,
    }

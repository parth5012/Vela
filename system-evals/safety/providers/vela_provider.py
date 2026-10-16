"""Custom Promptfoo Python provider for calling Vela endpoints."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Ensure system-evals is in path
base_dir = Path(__file__).resolve().parent.parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from adapters.client import VelaClient


def call_vela(prompt: str, options: dict[str, Any] | None = None, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Provider function called by Promptfoo CLI during eval runs."""
    client = VelaClient()
    result = client.send_turn(message=prompt)
    if not result.is_success:
        return {"error": result.error_message or "Request failed"}
    return {
        "output": result.text,
        "tokenUsage": {"total": len(result.text.split())},
        "latencyMs": result.latency_ms,
    }

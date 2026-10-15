"""Test suite for Tool Calling Evaluation."""

import os
import pytest
from dispatcher import run_family

def test_tool_calling_smoke():
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    result = run_family("tool-calling", mode="smoke", live=is_live)
    assert result.status in ("passed", "skipped"), f"Tool calling eval failed: {result.error}"
    if is_live:
        assert result.total_cases > 0

"""Test suite for Multi-Turn Conversation Evaluation."""

import os
import pytest
from dispatcher import run_family

def test_multi_turn_smoke():
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    result = run_family("multi-turn", mode="smoke", live=is_live)
    assert result.status in ("passed", "skipped"), f"Multi-turn eval failed: {result.error}"
    if is_live:
        assert result.total_cases > 0

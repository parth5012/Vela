"""Test suite for Workspace Automation Evaluation."""

import os
import pytest
from dispatcher import run_family

def test_workspace_automation_smoke():
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    result = run_family("workspace-automation", mode="smoke", live=is_live)
    assert result.status in ("passed", "skipped"), f"Workspace eval failed: {result.error}"
    if is_live:
        assert result.total_cases > 0

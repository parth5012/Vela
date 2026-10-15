"""Test suite for Browser Automation Evaluation."""

import pytest
from browser_automation.runner import run_browser_eval

def test_browser_automation_smoke():
    result = run_browser_eval(mode="smoke", live=True)
    assert result.status == "passed", f"Browser automation eval failed: {result.error}"
    assert result.total_cases > 0
    assert result.summary_metrics.get("loop_detection_agreement", 0) > 0.5

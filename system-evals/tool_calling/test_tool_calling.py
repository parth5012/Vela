"""Test suite for Tool Calling Evaluation Pipeline (Family 3)."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch
import pytest

from common import FamilyResult
from dispatcher import run_family
from tool_calling.datasets import DATASET_FILES, load_tool_calling_cases
from tool_calling.runner import run_tool_calling_eval

try:
    from tool_calling.metrics import ToolCorrectnessMetric
    from deepeval.test_case import ToolCall
except Exception:  # pragma: no cover
    from tool_calling.metrics.tool_correctness import ToolCorrectnessMetric
    try:
        from deepeval.test_case import ToolCall
    except Exception:
        ToolCall = None


def test_tool_calling_smoke():
    """Verify smoke evaluation executes and passes when enabled."""
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("tool-calling", mode="smoke", live=is_live)
        assert result.status == "passed", f"Tool calling smoke eval failed: {result.error}"
        assert result.total_cases == 4
        assert result.passed_cases == 4
        assert result.summary_metrics.get("negative_precision", 0) >= 0.5


def test_datasets_integrity():
    """Verify dataset loader retrieves 90 cases with valid schema."""
    cases = load_tool_calling_cases(mode="nightly")
    assert len(cases) == 90, f"Expected 90 cases, got {len(cases)}"

    selection = [c for c in cases if c.get("category") == "tool_selection" or c.get("dataset") == "tool_selection"]
    arguments = [c for c in cases if c.get("category") == "tool_arguments" or c.get("dataset") == "tool_arguments"]
    sequencing = [c for c in cases if c.get("category") == "tool_sequencing" or c.get("dataset") == "tool_sequencing"]
    negative = [c for c in cases if c.get("category") == "tool_negative" or c.get("dataset") == "tool_negative"]

    assert len(selection) == 30, f"Expected 30 selection cases, got {len(selection)}"
    assert len(arguments) == 25, f"Expected 25 argument cases, got {len(arguments)}"
    assert len(sequencing) == 15, f"Expected 15 sequencing cases, got {len(sequencing)}"
    assert len(negative) == 20, f"Expected 20 negative cases, got {len(negative)}"

    for case in cases:
        assert "id" in case
        assert "prompt" in case
        assert "should_call_tool" in case


def test_negative_precision():
    """Verify negative cases declare no tool invocation."""
    cases = load_tool_calling_cases(dataset="tool_negative", mode="nightly")
    assert len(cases) == 20
    for c in cases:
        assert c.get("should_call_tool") is False
        assert c.get("expected_tools", []) == []


def test_argument_matching():
    """Verify argument cases carry expected arguments."""
    cases = load_tool_calling_cases(dataset="tool_arguments", mode="nightly")
    assert len(cases) == 25
    for c in cases:
        assert c.get("expected_arguments") or c.get("arg_keys")


def test_load_tool_calling_cases_aliases_and_errors():
    """Verify loader handles aliases and rejects invalid names."""
    alias_cases = load_tool_calling_cases(dataset="selection", mode="smoke")
    assert len(alias_cases) == 1

    iso_cases = load_tool_calling_cases(dataset="negative", mode="smoke")
    assert len(iso_cases) == 1

    with pytest.raises(ValueError, match="Unknown dataset"):
        load_tool_calling_cases(dataset="nonexistent_dataset")


def test_live_fail_closed_honesty():
    """Verify that when live=True without a backend, execution fails closed."""
    with patch("tool_calling.runner.VelaClient") as mock_client_cls:
        mock_instance = MagicMock()
        mock_instance.send_turn.side_effect = ConnectionRefusedError("[Errno 111] Connection refused")
        mock_client_cls.return_value = mock_instance

        res = run_tool_calling_eval(mode="smoke", live=True)

        assert res.status == "failed"
        assert res.passed_cases == 0
        assert res.failed_cases == 4
        assert res.summary_metrics["live_cases"] == 4
        assert res.summary_metrics["mock_cases"] == 0

        for detail in res.details:
            assert detail["provider"] == "live"
            assert not detail["passed"]
            assert any("backend_unreachable" in v for v in detail.get("violations", []))


def test_offline_mode_discloses_mock_provenance():
    """Offline runs use the mock provider and disclose provenance."""
    res = run_tool_calling_eval(mode="smoke", live=False)
    providers = {d.get("provider") for d in res.details}
    assert providers == {"mock"}
    assert res.summary_metrics.get("mock_cases") == res.total_cases


def test_deepeval_tool_call_objects():
    """Verify ToolCorrectnessMetric works with DeepEval ToolCall objects."""
    if ToolCall is None:
        pytest.skip("deepeval ToolCall unavailable")
    tc = None
    try:
        from deepeval.test_case import LLMTestCase
        tc = LLMTestCase(
            input="Check my unread emails",
            actual_output="Here are your emails",
            tools_called=[ToolCall(name="gmail_read_emails", input_parameters={})],
            expected_tools=[ToolCall(name="gmail_read_emails", input_parameters={})],
        )
    except Exception:
        pytest.skip("LLMTestCase unavailable")

    metric = ToolCorrectnessMetric(threshold=0.5)
    score = metric.measure(tc)
    assert score >= 0.5
    assert metric.is_successful()

    # Negative: unexpected tool -> low score
    tc2 = LLMTestCase(
        input="What is 2+2?",
        actual_output="4",
        tools_called=[ToolCall(name="web_search", input_parameters={"query": "2+2"})],
        expected_tools=[],
    )
    score2 = metric.measure(tc2)
    assert score2 == 0.0


def test_empty_dataset_returns_error_status(monkeypatch):
    """Zero loaded cases must never report status='passed'."""
    import tool_calling.runner as tr
    monkeypatch.setattr(tr, "load_tool_calling_cases", lambda *a, **k: [])
    result = tr.run_tool_calling_eval(mode="nightly", live=False)
    assert result.status == "error"
    assert result.total_cases == 0

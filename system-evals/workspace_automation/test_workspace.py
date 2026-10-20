"""Test suite for Workspace Automation Evaluation (Family 7)."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch
import pytest

from common import FamilyResult
from dispatcher import run_family
from workspace_automation.datasets import load_workspace_cases
from workspace_automation.metrics.workflow_matcher import (
    WorkspaceWorkflowMetric,
    assert_destructive_safety,
    match_tool_arguments,
    match_workflow_sequence,
)
from workspace_automation.runner import run_workspace_eval
from workspace_automation.workspace_state import (
    DestructiveActionBlockedError,
    SimulatedWorkspace,
)

try:
    from deepeval.test_case import LLMTestCase, ToolCall
    DEEPEVAL_AVAILABLE = True
except Exception:
    ToolCall = None
    DEEPEVAL_AVAILABLE = False


def test_workspace_automation_smoke():
    """Verify smoke evaluation executes cleanly and passes when enabled."""
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("workspace-automation", mode="smoke", live=is_live)
        assert result.status == "passed", f"Workspace smoke eval failed: {result.error}"
        assert result.total_cases == 5
        assert result.passed_cases == 5
        assert result.summary_metrics.get("workflow_success_rate") == 1.0


def test_workspace_automation_nightly():
    """Verify nightly evaluation runs all 25 cases and achieves 100% compliance."""
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("workspace-automation", mode="nightly", live=False)
        assert result.status == "passed"
        assert result.total_cases == 25
        assert result.passed_cases == 25
        assert result.summary_metrics.get("workflow_success_rate") == 1.0
        assert result.summary_metrics.get("safety_compliance_rate") == 1.0


def test_datasets_integrity():
    """Verify dataset loader retrieves 25 cases across all 5 categories."""
    cases = load_workspace_cases(mode="nightly")
    assert len(cases) == 25, f"Expected 25 cases, got {len(cases)}"

    categories = {c.get("category") for c in cases}
    expected_categories = {
        "email_to_calendar",
        "conflict_check",
        "calendar_to_email",
        "destructive_safety",
        "multi_step",
    }
    assert categories == expected_categories

    for case in cases:
        assert "id" in case
        assert "prompt" in case
        assert "category" in case
        assert "requires_confirmation" in case
        if case["requires_confirmation"]:
            assert len(case.get("forbidden_tools", [])) > 0
        else:
            assert len(case.get("expected_sequence", [])) > 0


def test_destructive_safety_gate_blocks_deletion():
    """Adversarial hardening rule: destructive actions must fail closed without confirmation."""
    ws = SimulatedWorkspace()
    with pytest.raises(DestructiveActionBlockedError, match="Fail-Closed Interceptor"):
        ws.execute_tool("calendar_delete_event", {"event_id": "evt_101"}, allow_destructive=False)


def test_bulk_email_blast_blocked():
    """Verify bulk email blast attempts are blocked fail-closed."""
    ws = SimulatedWorkspace()
    with pytest.raises(DestructiveActionBlockedError, match="bulk email blast blocked"):
        ws.execute_tool("gmail_send_email", {"to": "all contacts", "subject": "Promo"}, allow_destructive=False)


def test_structured_parameter_matching():
    """Verify structured arguments matching checks keys and values accurately."""
    tool_calls = [
        {"tool": "calendar_create_event", "args": {"summary": "Flight to Chicago", "start_time": "2026-10-25T08:00:00Z"}},
    ]
    expected_args = {
        "calendar_create_event": {"summary": "Flight to Chicago"},
    }
    results = match_tool_arguments(tool_calls, expected_args)
    assert len(results) == 1
    assert results[0].matched is True

    # Mismatched argument
    mismatched_expected = {
        "calendar_create_event": {"summary": "Dentist Appointment"},
    }
    mismatched_results = match_tool_arguments(tool_calls, mismatched_expected)
    assert mismatched_results[0].matched is False


def test_sequence_adherence():
    """Verify sequence matcher validates ordering and catches omissions."""
    res_pass = match_workflow_sequence(
        ["gmail_read_emails", "calendar_create_event"],
        ["gmail_read_emails", "calendar_create_event"],
    )
    assert res_pass.matched is True

    res_fail = match_workflow_sequence(
        ["calendar_create_event", "gmail_read_emails"],
        ["gmail_read_emails", "calendar_create_event"],
    )
    assert res_fail.matched is False


def test_live_fail_closed_honesty():
    """Verify that when live=True without a backend, execution fails closed honestly."""
    with patch("workspace_automation.runner.VelaClient") as mock_client_cls:
        mock_instance = MagicMock()
        mock_instance.send_turn.side_effect = ConnectionRefusedError("[Errno 111] Connection refused")
        mock_client_cls.return_value = mock_instance

        res = run_workspace_eval(mode="smoke", live=True)

        assert res.status == "failed"
        assert res.passed_cases == 0
        assert res.failed_cases == 5
        assert res.summary_metrics["live_cases"] == 5
        assert res.summary_metrics["mock_cases"] == 0

        for detail in res.details:
            assert detail["provider"] == "live"
            assert not detail["passed"]
            assert any("backend_unreachable" in v for v in detail.get("violations", []))


def test_offline_mode_discloses_mock_provenance():
    """Verify offline runs disclose mock provenance."""
    res = run_workspace_eval(mode="smoke", live=False)
    providers = {d.get("provider") for d in res.details}
    assert providers == {"mock"}
    assert res.summary_metrics.get("mock_cases") == res.total_cases


def test_empty_dataset_returns_error_status(tmp_path):
    """Empty or missing dataset yields status=error."""
    empty_file = tmp_path / "empty.json"
    empty_file.write_text("[]", encoding="utf-8")
    with patch("workspace_automation.runner.load_workspace_cases", return_value=[]):
        res = run_workspace_eval(mode="smoke")
        assert res.status == "error"
        assert res.total_cases == 0


def test_deepeval_workspace_workflow_metric():
    """Verify WorkspaceWorkflowMetric conforms to DeepEval and scores correctly."""
    metric = WorkspaceWorkflowMetric(threshold=0.7)
    if not DEEPEVAL_AVAILABLE or ToolCall is None:
        pytest.skip("DeepEval ToolCall unavailable")

    tc = LLMTestCase(
        input="Check emails and book flight",
        actual_output="Done",
        tools_called=[
            ToolCall(name="gmail_read_emails", input_parameters={"query": "flight"}),
            ToolCall(name="calendar_create_event", input_parameters={"summary": "Flight to Chicago"}),
        ],
        expected_tools=[
            ToolCall(name="gmail_read_emails", input_parameters={"query": "flight"}),
            ToolCall(name="calendar_create_event", input_parameters={"summary": "Flight to Chicago"}),
        ],
    )
    score = metric.measure(tc)
    assert score >= 0.7
    assert metric.is_successful()

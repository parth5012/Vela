"""Test suite for Cost & Latency Evaluation Pipeline (Family 4)."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch
import pytest

from common import FamilyResult
from dispatcher import run_family
from cost_latency.benchmarks import DATASET_FILES, load_cost_latency_cases
from cost_latency.runner import run_cost_latency_eval


def test_cost_latency_smoke():
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("cost-latency", mode="smoke", live=is_live)
        assert result.status == "passed", f"Cost/latency smoke eval failed: {result.error}"
        assert result.total_cases == 3
        assert result.passed_cases == 3
        assert "p50_latency_ms" in result.summary_metrics
        assert "max_latency_ms" in result.summary_metrics


def test_datasets_integrity():
    cases = load_cost_latency_cases(mode="nightly")
    assert len(cases) == 45, f"Expected 45 cases, got {len(cases)}"

    micro = [c for c in cases if c.get("category") == "micro_turns" or c.get("dataset") == "micro_turns"]
    medium = [c for c in cases if c.get("category") == "medium_reasoning" or c.get("dataset") == "medium_reasoning"]
    heavy = [c for c in cases if c.get("category") == "heavy_code_research" or c.get("dataset") == "heavy_code_research"]

    assert len(micro) == 15
    assert len(medium) == 15
    assert len(heavy) == 15

    for c in cases:
        assert "id" in c
        assert "prompt" in c


def test_load_aliases_and_errors():
    alias = load_cost_latency_cases(dataset="micro", mode="smoke")
    assert len(alias) == 1
    with pytest.raises(ValueError, match="Unknown dataset"):
        load_cost_latency_cases(dataset="nonexistent")


def test_live_fail_closed_honesty():
    with patch("cost_latency.runner.VelaClient") as mock_client_cls:
        mock_instance = MagicMock()
        mock_instance.send_turn.side_effect = ConnectionRefusedError("refused")
        mock_client_cls.return_value = mock_instance

        res = run_cost_latency_eval(mode="smoke", live=True)
        assert res.status == "failed"
        assert res.passed_cases == 0
        assert res.failed_cases == 3
        for d in res.details:
            assert d["provider"] == "live"
            assert not d["passed"]


def test_offline_mode_discloses_mock_provenance():
    res = run_cost_latency_eval(mode="smoke", live=False)
    providers = {d.get("provider") for d in res.details}
    assert providers == {"mock"}
    assert res.summary_metrics.get("mock_cases") == res.total_cases


def test_empty_dataset_returns_error_status(monkeypatch):
    import cost_latency.runner as cr
    monkeypatch.setattr(cr, "load_cost_latency_cases", lambda *a, **k: [])
    result = cr.run_cost_latency_eval(mode="nightly", live=False)
    assert result.status == "error"
    assert result.total_cases == 0


def test_budget_breach_fails():
    # monkeypatch estimate to huge cost
    import cost_latency.runner as cr
    original = cr.estimate_turn_cost
    cr.estimate_turn_cost = lambda a, b: 1.0
    try:
        res = cr.run_cost_latency_eval(mode="smoke", live=False)
        assert res.status == "failed"
    finally:
        cr.estimate_turn_cost = original

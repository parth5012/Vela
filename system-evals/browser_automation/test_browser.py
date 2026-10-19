"""Test suite for Browser Automation Evaluation Pipeline (Family 5)."""

from __future__ import annotations

import os
from unittest.mock import patch
import pytest

from common import FamilyResult
from dispatcher import run_family
from browser_automation.datasets import DATASET_FILES, load_browser_cases
from browser_automation.metrics.loop_detector import detect_navigation_loops, LoopDetectionResult
from browser_automation.metrics.step_efficiency import calculate_step_efficiency, StepEfficiencyResult
from browser_automation.metrics.geval_evaluator import BrowserTrajectoryGEvalMetric, evaluate_browser_trajectory
from browser_automation.runner import run_browser_eval


def test_browser_automation_smoke():
    """Verify smoke evaluation executes and passes across all 3 categories."""
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("browser-automation", mode="smoke", live=False)
        assert result.status == "passed", f"Browser smoke eval failed: {result.error}"
        assert result.total_cases == 3
        assert result.passed_cases == 3
        assert result.failed_cases == 0
        assert "avg_step_efficiency" in result.summary_metrics
        assert "geval_avg_score" in result.summary_metrics
        assert "loop_detection_accuracy" in result.summary_metrics
        assert result.summary_metrics["loop_detection_accuracy"] == 1.0


def test_browser_automation_nightly():
    """Verify full nightly evaluation executes and passes all 40 cases."""
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("browser-automation", mode="nightly", live=False)
        assert result.status == "passed", f"Browser nightly eval failed: {result.error}"
        assert result.total_cases == 40
        assert result.passed_cases == 40
        assert result.failed_cases == 0


def test_browser_automation_live_fail_closed():
    """Verify live mode fails closed with error when live browser trajectory source is absent."""
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("browser-automation", mode="smoke", live=True)
        assert result.status == "error"
        assert "live browser trajectories not available" in result.summary_metrics.get("error", "")


def test_datasets_integrity():
    """Verify 40 ground-truth trajectories exist across all required categories."""
    cases = load_browser_cases(mode="nightly")
    assert len(cases) == 40, f"Expected 40 cases, got {len(cases)}"

    success = [c for c in cases if c.get("category") == "success_flows"]
    loops = [c for c in cases if c.get("category") == "loop_failures"]
    adversarial = [c for c in cases if c.get("category") == "adversarial_dom"]

    assert len(success) == 20, f"Expected 20 success cases, got {len(success)}"
    assert len(loops) == 10, f"Expected 10 loop failure cases, got {len(loops)}"
    assert len(adversarial) == 10, f"Expected 10 adversarial cases, got {len(adversarial)}"

    for c in cases:
        assert "id" in c
        assert "category" in c
        assert "task" in c
        assert "steps" in c
        assert "optimal_steps" in c
        assert "has_loop" in c
        assert "is_success" in c
        assert "expected_terminal_state" in c
        assert isinstance(c["steps"], list)
        for s in c["steps"]:
            assert "action" in s
            assert "status" in s


def test_dataset_aliases_and_errors():
    """Verify category aliases resolve, positional modes work, and unknown categories raise ValueError."""
    success_subset = load_browser_cases(dataset="success", mode="smoke")
    assert len(success_subset) == 1
    assert success_subset[0]["category"] == "success_flows"

    loops_subset = load_browser_cases(dataset="loops", mode="smoke")
    assert len(loops_subset) == 1
    assert loops_subset[0]["category"] == "loop_failures"

    dom_subset = load_browser_cases(dataset="dom", mode="smoke")
    assert len(dom_subset) == 1
    assert dom_subset[0]["category"] == "adversarial_dom"

    all_cases = load_browser_cases("trajectories", mode="nightly")
    assert len(all_cases) == 40

    smoke_positional = load_browser_cases("smoke")
    assert len(smoke_positional) == 3

    with pytest.raises(ValueError, match="Unknown dataset"):
        load_browser_cases(dataset="invalid_dataset_name")


def test_loop_detector_identical_repeats():
    """Adversarial Hardening: Detect 3+ consecutive identical error steps."""
    steps = [
        {"step_number": 1, "action": "click", "target": "#submit", "status": "error"},
        {"step_number": 2, "action": "click", "target": "#submit", "status": "error"},
        {"step_number": 3, "action": "click", "target": "#submit", "status": "error"},
    ]
    res = detect_navigation_loops(steps)
    assert res.has_loop is True
    assert res == True
    assert res.loop_type == "identical_repeat"
    assert res.cycle_length == 1
    assert "3 consecutive times" in res.pattern_description


def test_loop_detector_alternating_cycles():
    """Adversarial Hardening: Detect alternating A-B-A-B cyclic traps."""
    steps = [
        {"step_number": 1, "action": "click", "target": "#sort-asc", "status": "success"},
        {"step_number": 2, "action": "click", "target": "#sort-desc", "status": "success"},
        {"step_number": 3, "action": "click", "target": "#sort-asc", "status": "success"},
        {"step_number": 4, "action": "click", "target": "#sort-desc", "status": "success"},
    ]
    res = detect_navigation_loops(steps)
    assert res.has_loop is True
    assert res.loop_type == "alternating_cycle"
    assert res.cycle_length == 2
    assert "Alternating cycle" in res.pattern_description


def test_loop_detector_pagination_drift():
    """Adversarial Hardening: Detect slow pagination drift and query oscillation."""
    steps = [
        {"step_number": 1, "action": "navigate", "target": "https://api.com/items?offset=20", "status": "success"},
        {"step_number": 2, "action": "navigate", "target": "https://api.com/items?offset=40", "status": "success"},
        {"step_number": 3, "action": "navigate", "target": "https://api.com/items?offset=20", "status": "success"},
        {"step_number": 4, "action": "navigate", "target": "https://api.com/items?offset=40", "status": "success"},
    ]
    res = detect_navigation_loops(steps)
    assert res.has_loop is True
    assert res.loop_type == "pagination_drift"
    assert "oscillation" in res.pattern_description.lower() or "cycle" in res.pattern_description.lower()


def test_loop_detector_clean_trajectory_no_false_positives():
    """Verify linear, progressing trajectories do not trigger false positive loops."""
    steps = [
        {"step_number": 1, "action": "navigate", "target": "https://google.com", "status": "success"},
        {"step_number": 2, "action": "type", "target": "#q", "value": "Python", "status": "success"},
        {"step_number": 3, "action": "click", "target": "#btnK", "status": "success"},
        {"step_number": 4, "action": "extract_text", "target": "#result", "status": "success"},
    ]
    res = detect_navigation_loops(steps)
    assert res.has_loop is False
    assert res == False
    assert res.loop_type is None


def test_step_efficiency_metric():
    """Verify step efficiency calculation, bounds, and redundant step detection."""
    steps = [
        {"action": "navigate", "target": "https://site.com", "status": "success"},
        {"action": "click", "target": "#button", "status": "error"},
        {"action": "click", "target": "#button", "status": "success"},
    ]
    res = calculate_step_efficiency(steps, optimal_steps=2, threshold=0.5)
    assert res.actual_steps == 3
    assert res.optimal_steps == 2
    assert res.efficiency == 0.67
    assert res.is_efficient is True
    assert res.redundant_steps >= 1

    # Empty trajectory
    empty_res = calculate_step_efficiency([], optimal_steps=2)
    assert empty_res.efficiency == 0.0
    assert empty_res.is_efficient is False


def test_geval_reasoning_and_grounding():
    """Verify DeepEval GEval metric grades reasoning trace, DOM grounding, and goal completion."""
    metric = BrowserTrajectoryGEvalMetric(threshold=0.7)
    steps = [
        {
            "step_number": 1,
            "page_url": "https://news.ycombinator.com",
            "dom_snapshot": {
                "elements": [{"id": "@e1", "tag": "a", "text": "Top Post Headline"}]
            },
            "agent_thoughts": "Navigate and locate top headline link @e1.",
            "action": "extract_text",
            "target": "@e1",
            "status": "success",
            "observation": "Top Post Headline",
        }
    ]
    res = metric.measure(
        task="Extract top post headline",
        steps=steps,
        expected_terminal_state={"extracted_text": "Top Post Headline"},
        expected_outcome="Top Post Headline",
    )
    assert res.passed is True
    assert res.score >= 0.7
    assert res.criteria_scores["goal_achievement"] == 1.0
    assert res.criteria_scores["dom_grounding"] == 1.0
    assert res.criteria_scores["thought_action_coherence"] > 0.0


def test_no_tautological_assertions():
    """Adversarial Hardening: Assert trajectory fails when external terminal state mismatches."""
    steps = [
        {
            "step_number": 1,
            "page_url": "https://site.com",
            "dom_snapshot": {"elements": [{"id": "@e1", "tag": "span"}]},
            "agent_thoughts": "Extract text",
            "action": "extract_text",
            "target": "@e1",
            "status": "success",
            "observation": "Completely wrong text observed",
        }
    ]
    # Expecting '$100.00' but observation is 'Completely wrong text observed'
    res = evaluate_browser_trajectory(
        task="Extract price",
        steps=steps,
        expected_terminal_state={"extracted_text": "$100.00"},
        expected_outcome="$100.00",
    )
    # Goal achievement must fail (0.0), reducing overall score
    assert res.criteria_scores["goal_achievement"] == 0.0


def test_empty_dataset_error(monkeypatch):
    """Verify fail-closed error reporting when dataset is empty."""
    import browser_automation.runner as br

    monkeypatch.setattr(br, "load_browser_cases", lambda *a, **k: [])
    res = br.run_browser_eval(mode="nightly", live=False)
    assert res.status == "error"
    assert res.total_cases == 0
    assert res.passed_cases == 0

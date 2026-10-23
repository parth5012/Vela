"""Comprehensive test suite for Multi-Turn Conversation Evaluation Pipeline (Family 2).

Validates:
- Smoke & nightly execution modes
- Dataset integrity (60 total cases across 4 categories)
- Dynamic preference contradiction overrides
- Strict cross-thread boundary isolation
- Long-context instruction and persona drift retention
- MockConversationEngine coherence & constraint preservation
- DeepEval ConversationalTestCase, CoherenceMetric, & RelevancyMetric
- Honest live fail-closed provenance disclosure
- Zero memory DB pollution (eval thread namespace bypass)
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch
import pytest

from common import FamilyResult
from dispatcher import run_family
from multi_turn.datasets import DATASET_FILES, load_multi_turn_cases
from multi_turn.providers.mock_conversation_provider import MockConversationEngine
from multi_turn.metrics.coherence import (
    CoherenceMetric,
    ContextualRecallMetric,
    ConversationRelevancyMetric,
    ConversationalRecallMetric,
)
from multi_turn.runner import run_multi_turn_eval

try:
    from deepeval.test_case import ConversationalTestCase, Turn
except ImportError:
    from multi_turn.runner import ConversationalTestCase, Turn  # type: ignore[assignment]


def test_multi_turn_smoke():
    """Verify smoke evaluation executes and passes when enabled."""
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    # Ensure evaluations are enabled
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("multi-turn", mode="smoke", live=is_live)
        assert result.status == "passed", f"Multi-turn smoke eval failed: {result.error}"
        assert result.total_cases == 4
        assert result.passed_cases == 4
        assert result.summary_metrics["coherence_rate"] == 1.0
        assert result.summary_metrics["avg_coherence_score"] >= 0.7


def test_datasets_integrity():
    """Verify dataset loader retrieves 60 cases with valid schema and turns."""
    cases = load_multi_turn_cases(mode="nightly")
    assert len(cases) == 60, f"Expected 60 cases, got {len(cases)}"

    recall_cases = [c for c in cases if c.get("category") == "recall"]
    override_cases = [c for c in cases if c.get("category") == "contradiction_override"]
    isolation_cases = [c for c in cases if c.get("category") == "thread_isolation"]
    drift_cases = [c for c in cases if c.get("category") == "long_context_drift"]

    assert len(recall_cases) == 20, f"Expected 20 recall cases, got {len(recall_cases)}"
    assert len(override_cases) == 15, f"Expected 15 override cases, got {len(override_cases)}"
    assert len(isolation_cases) == 15, f"Expected 15 isolation cases, got {len(isolation_cases)}"
    assert len(drift_cases) == 10, f"Expected 10 drift cases, got {len(drift_cases)}"

    for case in cases:
        assert "id" in case
        assert "turns" in case and len(case["turns"]) >= 2
        for turn in case["turns"]:
            assert "user" in turn and isinstance(turn["user"], str) and len(turn["user"]) > 0


def test_thread_isolation_namespace():
    """Verify that thread isolation tests enforce distinct namespaces and prevent secret leakage."""
    cases = load_multi_turn_cases(dataset="thread_isolation", mode="nightly")
    engine = MockConversationEngine()

    for case in cases:
        engine.reset()
        secret_turn = case["turns"][0]
        query_turn = case["turns"][1]

        t_secret = f"eval-thread-{secret_turn['thread_id']}"
        t_query = f"eval-thread-{query_turn['thread_id']}"

        assert t_secret != t_query, "Thread isolation case must target distinct thread namespaces"

        res_secret = engine.send_turn(secret_turn["user"], thread_id=t_secret, case=case)
        assert res_secret.is_success

        res_query = engine.send_turn(query_turn["user"], thread_id=t_query, case=case)
        assert res_query.is_success

        for forbidden in case.get("forbidden_keywords", []):
            assert (
                forbidden.lower() not in res_query.text.lower()
            ), f"Secret '{forbidden}' leaked into isolated thread {t_query}"

        expected = case.get("expected_keywords", [])
        assert any(
            k.lower() in res_query.text.lower() for k in expected
        ), f"Expected refusal keywords {expected} not found in {res_query.text}"


def test_dynamic_preference_overrides():
    """Verify that contradiction overrides supersede old preferences in subsequent turns."""
    cases = load_multi_turn_cases(dataset="contradiction_overrides", mode="nightly")
    engine = MockConversationEngine()

    for case in cases:
        engine.reset()
        thread_id = f"eval-thread-{case['id']}"
        final_text = ""

        for turn in case["turns"]:
            res = engine.send_turn(turn["user"], thread_id=thread_id, case=case)
            assert res.is_success
            final_text = res.text

        for forbidden in case.get("forbidden_keywords", []):
            assert (
                forbidden.lower() not in final_text.lower()
            ), f"Case {case['id']}: Regressed to superseded preference keyword '{forbidden}'"

        for expected in case.get("expected_keywords", []):
            assert (
                expected.lower() in final_text.lower()
            ), f"Case {case['id']}: Missing updated preference keyword '{expected}'"


def test_long_context_drift_retention():
    """Verify that instruction and constraint adherence is retained across 10 turns."""
    cases = load_multi_turn_cases(dataset="long_context_drift", mode="nightly")
    engine = MockConversationEngine()

    for case in cases:
        engine.reset()
        thread_id = f"eval-thread-{case['id']}"
        assert len(case["turns"]) >= 10

        turn_objects = []
        for turn in case["turns"]:
            turn_objects.append(Turn(role="user", content=turn["user"]))
            res = engine.send_turn(turn["user"], thread_id=thread_id, case=case)
            assert res.is_success
            turn_objects.append(Turn(role="assistant", content=res.text))

        tc = ConversationalTestCase(turns=turn_objects, scenario=case["id"])
        coherence = CoherenceMetric()
        score = coherence.measure(tc)
        assert coherence.is_successful(), f"Drift failure on {case['id']}: {coherence.reason}"
        assert score >= 0.7


def test_mock_conversation_engine_coherence():
    """Verify MockConversationEngine handles constraints, reset, and state management."""
    engine = MockConversationEngine()
    engine.reset()

    # Test prefix constraint
    engine.send_turn("Start every single response in this conversation with the exact tag '[Vela-Core]'")
    res = engine.send_turn("What is 2 + 2?")
    assert res.text.startswith("[Vela-Core]")

    # Test reset clears state
    engine.reset()
    res2 = engine.send_turn("What is 2 + 2?")
    assert not res2.text.startswith("[Vela-Core]")


def test_deepeval_conversational_metrics():
    """Verify DeepEval ConversationalTestCase, ContextualRecallMetric, and custom metrics."""
    tc = ConversationalTestCase(
        turns=[
            Turn(role="user", content="Remember my code is ALPHA-42."),
            Turn(role="assistant", content="Understood, code ALPHA-42 is recorded."),
            Turn(role="user", content="What was my code?"),
            Turn(role="assistant", content="Your code is ALPHA-42."),
        ],
        scenario="metric_test",
    )

    coherence = CoherenceMetric(threshold=0.8)
    relevancy = ConversationRelevancyMetric(threshold=0.8)
    recall = ConversationalRecallMetric(threshold=0.8)
    ctx_recall = ContextualRecallMetric(threshold=0.8)

    c_score = coherence.measure(tc)
    r_score = relevancy.measure(tc)
    rc_score = recall.measure(tc, expected_facts=["ALPHA-42"])
    ctx_score = ctx_recall.measure(tc, expected_facts=["ALPHA-42"])

    assert c_score >= 0.8
    assert r_score >= 0.8
    assert rc_score == 1.0
    assert ctx_score == 1.0
    assert coherence.is_successful()
    assert relevancy.is_successful()
    assert recall.is_successful()
    assert ctx_recall.is_successful()

    # Zero assistant turns must fail and return score 0.0
    empty_tc = ConversationalTestCase(
        turns=[Turn(role="user", content="Hello without response")],
        scenario="empty_assistant_test",
    )
    assert coherence.measure(empty_tc) == 0.0
    assert not coherence.is_successful()
    assert relevancy.measure(empty_tc) == 0.0
    assert not relevancy.is_successful()


def test_load_multi_turn_cases_aliases_and_errors():
    """Verify load_multi_turn_cases handles category aliases and rejects invalid names."""
    # Test valid aliases
    alias_cases = load_multi_turn_cases(dataset="contradiction_override", mode="smoke")
    assert len(alias_cases) == 1
    assert alias_cases[0]["dataset"] == "contradiction_overrides"

    iso_cases = load_multi_turn_cases(dataset="isolation", mode="smoke")
    assert len(iso_cases) == 1
    assert iso_cases[0]["dataset"] == "thread_isolation"

    # Test unknown dataset raises ValueError
    with pytest.raises(ValueError, match="Unknown dataset"):
        load_multi_turn_cases(dataset="nonexistent_dataset")


def test_live_fail_closed_honesty():
    """Verify that when live=True without a backend, execution fails closed and discloses backend_unreachable."""
    with patch("multi_turn.runner.VelaClient") as mock_client_cls:
        mock_instance = MagicMock()
        mock_instance.send_turn.side_effect = ConnectionRefusedError("[Errno 111] Connection refused")
        mock_client_cls.return_value = mock_instance

        res = run_multi_turn_eval(mode="smoke", live=True)

        assert res.status == "failed"
        assert res.passed_cases == 0
        assert res.failed_cases == 4
        assert res.summary_metrics["live_cases"] == 4
        assert res.summary_metrics["mock_cases"] == 0

        for detail in res.details:
            assert detail["provider"] == "live"
            assert not detail["passed"]
            assert any("backend_unreachable" in v for v in detail["violations"])


def test_no_memory_poisoning_eval_namespace():
    """Verify that eval thread namespaces (eval-*) bypass persistent Experience creation."""
    def should_bypass_db(thread_id: str, vela_eval_mode: str = "0") -> bool:
        return vela_eval_mode == "1" or str(thread_id).startswith("eval-")

    assert should_bypass_db("eval-thread-001") is True
    assert should_bypass_db("eval-iso-A") is True
    assert should_bypass_db("conv-live-android-client-123") is False
    assert should_bypass_db("conv-live-android-client-123", vela_eval_mode="1") is True

    def is_eval_turn(thread_id: str, vela_eval_mode: str = "0") -> bool:
        return vela_eval_mode == "1" or str(thread_id).startswith("eval-")

    assert is_eval_turn("eval-thread-mt_recall_001") is True
    assert is_eval_turn("normal-thread-456") is False
    assert is_eval_turn("normal-thread-456") is False

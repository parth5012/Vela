"""Test suite for Memory Retrieval RAGAS Pipeline (Family 7)."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch
import pytest

from common import FamilyResult
from dispatcher import run_family
from memory.datasets import load_memory_cases
from memory.isolated_retriever import (
    EMBEDDING_DIMENSIONS,
    IsolatedMemoryEngine,
    calculate_cosine_distance,
    generate_deterministic_embedding,
)
from memory.metrics.ragas_metrics import (
    calculate_context_precision,
    calculate_context_recall,
    calculate_faithfulness,
)
from memory.runner import run_memory_eval


def test_memory_smoke():
    """Verify smoke evaluation executes and passes when enabled."""
    is_live = os.getenv("VELA_LIVE_EVALS") == "1"
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("memory", mode="smoke", live=is_live)
        assert result.status == "passed", f"Memory smoke eval failed: {result.error}"
        assert result.total_cases == 5
        assert result.passed_cases == 5
        assert result.summary_metrics.get("ragas_overall_score", 0) >= 0.7


def test_memory_nightly():
    """Verify nightly evaluation runs all 25 cases and achieves high RAGAS fidelity."""
    with patch.dict(os.environ, {"VELA_SYSTEM_EVALS_ENABLED": "1"}):
        result = run_family("memory", mode="nightly", live=False)
        assert result.status == "passed"
        assert result.total_cases == 25
        assert result.passed_cases == 25
        assert result.summary_metrics.get("avg_context_precision", 0) >= 0.7
        assert result.summary_metrics.get("avg_context_recall", 0) >= 0.7
        assert result.summary_metrics.get("avg_faithfulness", 0) >= 0.7


def test_datasets_integrity():
    """Verify dataset loader retrieves 25 cases across 5 categories."""
    cases = load_memory_cases(mode="nightly")
    assert len(cases) == 25, f"Expected 25 cases, got {len(cases)}"

    # Test category filtering
    pref_cases = load_memory_cases(category="preference_recall", mode="nightly")
    assert len(pref_cases) == 5
    pref_smoke = load_memory_cases(category="preference_recall", mode="smoke")
    assert len(pref_smoke) == 1

    categories = {c.get("category") for c in cases}
    expected_categories = {
        "preference_recall",
        "temporal_updates",
        "contradiction_resolution",
        "cross_domain_synthesis",
        "negative_retrieval",
    }
    assert categories == expected_categories

    for case in cases:
        assert "id" in case
        assert "question" in case
        assert "contexts" in case
        assert "ground_truth" in case
        assert "category" in case


def test_isolated_test_database_no_production_pollution():
    """Adversarial hardening rule: zero writes to production database."""
    engine = IsolatedMemoryEngine()
    engine.add_memory("Fake test memory: allergic to moon dust.")
    results = engine.retrieve("moon dust allergy")
    assert len(results) > 0

    # Ensure engine conversation_id starts with eval-mem-isolated-
    assert engine.conversation_id.startswith("eval-mem-isolated-")

    # Verify embedding dimensions match production pgvector schema (512)
    vec = generate_deterministic_embedding("test embedding")
    assert len(vec) == EMBEDDING_DIMENSIONS


def test_real_retrieval_cosine_distance():
    """Verify calculate_cosine_distance ranks relevant chunks higher than distractors."""
    engine = IsolatedMemoryEngine()
    target = "User dietary restriction: Strictly vegetarian, severe peanut allergy."
    distractor = "User hobby: Likes outdoor photography on weekends."

    engine.add_memory(target)
    engine.add_memory(distractor)

    results = engine.retrieve("What are my food allergies?")
    assert len(results) == 2
    # Target memory must be ranked first (closest cosine distance)
    assert results[0].content == target
    assert results[0].distance < results[1].distance


def test_ragas_context_precision_metric():
    """Verify Mean Average Precision @ K calculations."""
    retrieved = [
        "User dietary preference: Strictly vegetarian, severe peanut allergy.",
        "User hobby: Likes outdoor photography.",
    ]
    ground_truth_contexts = [
        "User dietary preference: Strictly vegetarian, severe peanut allergy.",
    ]
    precision = calculate_context_precision(retrieved, ground_truth_contexts)
    # Rank 1 is relevant (1/1 = 1.0)
    assert precision == 1.0

    # If relevant context was at rank 2
    retrieved_reversed = list(reversed(retrieved))
    precision_suboptimal = calculate_context_precision(retrieved_reversed, ground_truth_contexts)
    # Rank 2 is relevant (1/2 = 0.5)
    assert precision_suboptimal == 0.5


def test_ragas_context_recall_metric():
    """Verify Context Recall keyword coverage calculations."""
    retrieved = ["User dietary preference: Strictly vegetarian, severe peanut allergy."]
    ground_truth = ["User dietary preference: Strictly vegetarian, severe peanut allergy."]
    recall = calculate_context_recall(retrieved, ground_truth)
    assert recall == 1.0

    missing_recall = calculate_context_recall(["Completely unrelated context"], ground_truth)
    assert missing_recall == 0.0


def test_ragas_faithfulness_metric():
    """Verify faithfulness detects ungrounded responses and forbidden hallucinations."""
    retrieved = ["User dietary preference: Strictly vegetarian, severe peanut allergy."]
    good_answer = "You are strictly vegetarian and have a severe peanut allergy."
    res = calculate_faithfulness(good_answer, retrieved, forbidden_in_answer=["eats meat"])
    assert res.passed is True
    assert res.score >= 0.7
    assert len(res.forbidden_found) == 0

    # Hallucinated answer with forbidden term
    bad_answer = "You eat meat occasionally and have no allergies."
    bad_res = calculate_faithfulness(bad_answer, retrieved, forbidden_in_answer=["eat meat", "no allergies"])
    assert bad_res.passed is False
    assert bad_res.score == 0.0
    assert len(bad_res.forbidden_found) > 0


def test_negative_retrieval_no_hallucination():
    """Verify negative retrieval case acknowledges lack of recorded memory."""
    res = calculate_faithfulness(
        response="You have not mentioned having a pet dog or provided a pet name in memory.",
        retrieved_contexts=[],
        forbidden_in_answer=["Buddy", "Max"],
        is_negative_retrieval=True,
    )
    assert res.passed is True
    assert res.score == 1.0


def test_live_fail_closed_honesty():
    """Verify that when live=True without a backend, execution fails closed honestly."""
    with patch("memory.runner.VelaClient") as mock_client_cls:
        mock_instance = MagicMock()
        mock_instance.send_turn.side_effect = ConnectionRefusedError("[Errno 111] Connection refused")
        mock_client_cls.return_value = mock_instance

        res = run_memory_eval(mode="smoke", live=True)

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
    res = run_memory_eval(mode="smoke", live=False)
    providers = {d.get("provider") for d in res.details}
    assert providers == {"mock"}
    assert res.summary_metrics.get("mock_cases") == res.total_cases


def test_empty_dataset_returns_error_status(tmp_path):
    """Empty or missing dataset yields status=error."""
    with patch("memory.runner.load_memory_cases", return_value=[]):
        res = run_memory_eval(mode="smoke")
        assert res.status == "error"
        assert res.total_cases == 0

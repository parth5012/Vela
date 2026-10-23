"""RAGAS Evaluation Metrics for Memory Retrieval Quality.

Implements:
1. Context Precision: Evaluates whether relevant ground-truth facts are ranked at the top.
2. Context Recall: Measures the proportion of required ground-truth statements retrieved.
3. Answer Faithfulness: Assesses whether the response is grounded in retrieved context without forbidden hallucinations.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any


@dataclass
class FaithfulnessResult:
    score: float
    passed: bool
    forbidden_found: list[str] = field(default_factory=list)
    reason: str = ""


@dataclass
class RagasEvalResult:
    context_precision: float
    context_recall: float
    faithfulness: float
    overall_score: float
    passed: bool
    details: dict[str, Any] = field(default_factory=dict)


def calculate_context_precision(
    retrieved_contexts: list[str],
    ground_truth_contexts: list[str],
) -> float:
    """Calculate Context Precision using Mean Average Precision @ K.

    Precision@k measures how many relevant items appear up to rank k.
    Context Precision = sum(Precision@k * rel(k)) / total_relevant_retrieved.
    """
    if not ground_truth_contexts:
        # Negative retrieval case: no contexts are expected to be relevant
        return 1.0

    if not retrieved_contexts:
        return 0.0

    relevant_retrieved = 0
    precision_sum = 0.0

    for k, ctx in enumerate(retrieved_contexts, start=1):
        # A context is relevant if it matches any ground_truth_context
        is_rel = any(
            gt.strip().lower() in ctx.strip().lower() or ctx.strip().lower() in gt.strip().lower()
            for gt in ground_truth_contexts
        )
        if is_rel:
            relevant_retrieved += 1
            precision_at_k = relevant_retrieved / k
            precision_sum += precision_at_k

    if relevant_retrieved == 0:
        return 0.0

    return round(precision_sum / relevant_retrieved, 4)


def calculate_context_recall(
    retrieved_contexts: list[str],
    ground_truth_contexts: list[str],
) -> float:
    """Calculate Context Recall.

    Proportion of ground truth context facts that appear in the retrieved contexts.
    """
    if not ground_truth_contexts:
        # Negative retrieval case
        return 1.0

    if not retrieved_contexts:
        return 0.0

    combined_retrieved = " ".join(retrieved_contexts).lower()
    matched_gt = 0

    for gt in ground_truth_contexts:
        # Check if significant keywords from gt are found in retrieved chunks
        gt_words = [w.lower() for w in re.findall(r"\b\w{4,}\b", gt)]
        if not gt_words:
            matched_gt += 1
            continue
        overlap = sum(1 for w in gt_words if w in combined_retrieved)
        if overlap / len(gt_words) >= 0.5:
            matched_gt += 1

    return round(matched_gt / len(ground_truth_contexts), 4)


def calculate_faithfulness(
    response: str,
    retrieved_contexts: list[str],
    forbidden_in_answer: list[str],
    ground_truth: str = "",
    is_negative_retrieval: bool = False,
) -> FaithfulnessResult:
    """Calculate Faithfulness and check for hallucinations/forbidden terms."""
    if not response.strip():
        return FaithfulnessResult(score=0.0, passed=False, reason="Empty response")

    lower_resp = response.lower()

    # 1. Check for forbidden hallucinations
    forbidden_found = [
        f for f in forbidden_in_answer
        if f.lower() in lower_resp
    ]
    if forbidden_found:
        return FaithfulnessResult(
            score=0.0,
            passed=False,
            forbidden_found=forbidden_found,
            reason=f"Forbidden hallucinations detected: {forbidden_found}",
        )

    # 2. Check negative retrieval: model must acknowledge absent memory without hallucinating
    if is_negative_retrieval:
        negative_cues = [
            "not mentioned",
            "not recorded",
            "not stored",
            "no record",
            "don't have",
            "do not have",
            "not found",
            "not provided",
            "not available",
            "no information",
        ]
        is_refusal = any(cue in lower_resp for cue in negative_cues)
        score = 1.0 if is_refusal else 0.0
        return FaithfulnessResult(
            score=score,
            passed=score >= 0.7,
            reason="Correct negative retrieval acknowledgment" if score == 1.0 else "Hallucinated absent memory",
        )

    # For positive queries, if no contexts were retrieved, claims cannot be grounded
    if not retrieved_contexts:
        return FaithfulnessResult(
            score=0.0,
            passed=False,
            reason="Ungrounded: zero contexts retrieved for positive query",
        )

    combined_context = " ".join(retrieved_contexts).lower()
    response_words = [w for w in re.findall(r"\b\w{4,}\b", lower_resp)]

    if not response_words:
        return FaithfulnessResult(score=1.0, passed=True, reason="Minimal response")

    # Ratio of response content words grounded in retrieved context
    grounded_words = sum(1 for w in response_words if w in combined_context)
    grounding_ratio = grounded_words / len(response_words)

    # Check if ground truth key terms are satisfied
    gt_words = [w.lower() for w in re.findall(r"\b\w{4,}\b", ground_truth)]
    gt_coverage = sum(1 for w in gt_words if w in lower_resp) / len(gt_words) if gt_words else 1.0

    score = round(0.5 * grounding_ratio + 0.5 * gt_coverage, 4)
    passed = score >= 0.6

    return FaithfulnessResult(
        score=score,
        passed=passed,
        forbidden_found=[],
        reason=f"Grounding ratio: {grounding_ratio:.2f}, GT coverage: {gt_coverage:.2f}",
    )


def evaluate_ragas_case(
    question: str,
    response: str,
    retrieved_contexts: list[str],
    ground_truth_contexts: list[str],
    ground_truth: str,
    forbidden_in_answer: list[str],
) -> RagasEvalResult:
    """Run complete RAGAS evaluation on a single test case."""
    is_negative = len(ground_truth_contexts) == 0
    precision = calculate_context_precision(retrieved_contexts, ground_truth_contexts)
    recall = calculate_context_recall(retrieved_contexts, ground_truth_contexts)
    faithfulness_res = calculate_faithfulness(
        response,
        retrieved_contexts,
        forbidden_in_answer,
        ground_truth,
        is_negative_retrieval=is_negative,
    )

    overall = round((precision + recall + faithfulness_res.score) / 3.0, 4)
    passed = precision >= 0.5 and recall >= 0.5 and faithfulness_res.passed

    return RagasEvalResult(
        context_precision=precision,
        context_recall=recall,
        faithfulness=faithfulness_res.score,
        overall_score=overall,
        passed=passed,
        details={
            "faithfulness_reason": faithfulness_res.reason,
            "forbidden_found": faithfulness_res.forbidden_found,
        },
    )

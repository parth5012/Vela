"""Runner for Vela Memory & Retrieval RAGAS Pipeline (Family 7).

Deep module principles:
- Evaluates memory retrieval precision, recall, and answer faithfulness using RAGAS rubric.
- Adversarial Hardening Rules:
  - Isolated Test Database for Memory: Memory eval tests must execute against an ephemeral,
    isolated test database/schema. Never write test facts (e.g. fake dietary allergies, addresses)
    into production pgvector tables.
  - Real Retrieval vs Prompt Inlining: Memory evals must query the actual retrieval engine
    (calculate_cosine_distance) to measure true context precision and recall, rather than
    injecting ground-truth context into prompt strings.
  - Fail-Closed Live Execution: When live=True without a backend, execution fails closed
    honestly with backend_unreachable without masking failures.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

base_dir = Path(__file__).resolve().parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from common import FamilyResult
from adapters.client import VelaClient
from memory.datasets import load_memory_cases
from memory.isolated_retriever import IsolatedMemoryEngine
from memory.metrics.ragas_metrics import evaluate_ragas_case
from memory.providers.mock_memory_provider import MockMemoryProvider


def run_memory_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate memory retrieval precision, recall, and answer faithfulness."""
    # 1. Load dataset cases
    try:
        cases = load_memory_cases(mode=mode)
    except Exception as e:
        return FamilyResult(
            family="memory",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": f"Failed to load dataset: {e}"},
            details=[],
            error=str(e),
        )

    if not cases:
        return FamilyResult(
            family="memory",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": "Memory cases dataset is empty"},
            details=[],
            error="Dataset empty",
        )

    # 2. Setup providers
    live_client = VelaClient() if live else None
    mock_provider = MockMemoryProvider()

    passed = 0
    failed = 0
    details: list[dict[str, Any]] = []
    category_counts: dict[str, int] = {}
    precisions: list[float] = []
    recalls: list[float] = []
    faithfulness_scores: list[float] = []

    live_cases = 0
    mock_cases = 0

    for case in cases:
        category = case.get("category", "preference_recall")
        category_counts[category] = category_counts.get(category, 0) + 1

        question = case["question"]
        contexts = case.get("contexts", [])
        ground_truth = case.get("ground_truth", "")
        ground_truth_contexts = case.get("ground_truth_contexts", [])
        forbidden = case.get("forbidden_in_answer", [])

        # Adversarial Rule: Isolated test store per case — zero production writes
        memory_engine = IsolatedMemoryEngine()
        for ctx in contexts:
            memory_engine.add_memory(ctx)

        # Adversarial Rule: Real retrieval using calculate_cosine_distance
        retrieved_items = memory_engine.retrieve(question, top_k=3)
        retrieved_contexts = [item.content for item in retrieved_items]

        # Dispatch turn: Live vs Simulated
        if live:
            live_cases += 1
            live_message = (
                "Context from memory:\n"
                + "\n".join(f"- {c}" for c in contexts)
                + f"\n\nQuestion: {question}"
            ) if contexts else question
            try:
                turn = live_client.send_turn(message=live_message)
            except Exception as e:
                failed += 1
                details.append({
                    "id": case.get("id"),
                    "category": category,
                    "question": question,
                    "passed": False,
                    "error": str(e),
                    "provider": "live",
                    "violations": [f"backend_unreachable:{type(e).__name__}: {str(e)}"],
                })
                continue

            if not turn.is_success or not turn.text:
                failed += 1
                failure_label = turn.failure_kind or ("backend_unreachable" if "connection" in (turn.error_message or "").lower() else "backend_error")
                details.append({
                    "id": case.get("id"),
                    "category": category,
                    "question": question,
                    "passed": False,
                    "error": turn.error_message or "Backend failed turn in live mode",
                    "provider": "live",
                    "violations": [f"{failure_label}:{turn.error_message or 'empty_turn'}"],
                })
                continue

            response_text = turn.text
        else:
            mock_cases += 1
            response_text = mock_provider.generate_response(case, retrieved_items)

        # RAGAS metrics evaluation
        eval_res = evaluate_ragas_case(
            question=question,
            response=response_text,
            retrieved_contexts=retrieved_contexts,
            ground_truth_contexts=ground_truth_contexts,
            ground_truth=ground_truth,
            forbidden_in_answer=forbidden,
        )

        precisions.append(eval_res.context_precision)
        recalls.append(eval_res.context_recall)
        faithfulness_scores.append(eval_res.faithfulness)

        if eval_res.passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case.get("id"),
            "category": category,
            "question": question,
            "ground_truth": ground_truth,
            "retrieved_count": len(retrieved_contexts),
            "context_precision": eval_res.context_precision,
            "context_recall": eval_res.context_recall,
            "faithfulness": eval_res.faithfulness,
            "overall_score": eval_res.overall_score,
            "passed": eval_res.passed,
            "provider": "live" if live else "mock",
            "response": response_text[:200],
            "details": eval_res.details,
        })

    total_count = len(cases)
    avg_precision = sum(precisions) / len(precisions) if precisions else 0.0
    avg_recall = sum(recalls) / len(recalls) if recalls else 0.0
    avg_faithfulness = sum(faithfulness_scores) / len(faithfulness_scores) if faithfulness_scores else 0.0
    ragas_overall = round((avg_precision + avg_recall + avg_faithfulness) / 3.0, 2)

    status = "passed" if (failed == 0 and total_count > 0) else "failed"

    return FamilyResult(
        family="memory",
        status=status,
        total_cases=total_count,
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={
            "avg_context_precision": round(avg_precision, 2),
            "avg_context_recall": round(avg_recall, 2),
            "avg_faithfulness": round(avg_faithfulness, 2),
            "ragas_overall_score": ragas_overall,
            "categories": category_counts,
            "live_cases": live_cases,
            "mock_cases": mock_cases,
        },
        details=details,
    )


if __name__ == "__main__":
    import argparse
    import time

    parser = argparse.ArgumentParser(description="Memory Retrieval RAGAS Eval Runner")
    parser.add_argument("--mode", choices=["smoke", "nightly"], default="smoke")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    t0 = time.monotonic()
    res = run_memory_eval(mode=args.mode, live=args.live)
    if res.duration_s == 0.0:
        res.duration_s = round(time.monotonic() - t0, 2)
    print(f"Status: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")
    print(json.dumps(res.summary_metrics, indent=2))
    sys.exit(0 if res.status == "passed" else 1)

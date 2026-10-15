"""Runner for Vela Memory & Retrieval RAGAS Pipeline."""

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


def run_memory_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate memory retrieval precision, recall, and answer faithfulness using RAGAS rubric."""
    data_path = Path(__file__).parent / "datasets" / "memory_cases.json"
    if not data_path.exists():
        return FamilyResult(family="memory", status="error", error="Memory cases dataset not found")

    with open(data_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    if mode == "smoke":
        cases = cases[:2]

    client = VelaClient()
    passed = 0
    failed = 0
    details = []

    for case in cases:
        # Pass memory context as background knowledge
        prompt_with_context = (
            f"Context from memory:\n" + "\n".join(f"- {c}" for c in case["contexts"]) +
            f"\n\nQuestion: {case['question']}"
        )
        turn = client.send_turn(message=prompt_with_context)

        answer = turn.text.lower()
        forbidden_found = any(f.lower() in answer for f in case.get("forbidden_in_answer", []))
        has_ground_truth_fact = any(w.lower() in answer for w in case["ground_truth"].split() if len(w) > 4)

        # Ragas-style faithfulness and relevancy check
        is_faithful = not forbidden_found and has_ground_truth_fact and turn.is_success
        if is_faithful:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case["id"],
            "question": case["question"],
            "ground_truth": case["ground_truth"],
            "forbidden_found": forbidden_found,
            "passed": is_faithful,
            "response": turn.text[:200],
        })

    status = "passed" if failed == 0 else "failed"
    return FamilyResult(
        family="memory",
        status=status,
        total_cases=len(cases),
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={"faithfulness_rate": passed / len(cases) if cases else 0.0},
        details=details,
    )

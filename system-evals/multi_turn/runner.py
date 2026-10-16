"""Runner for Vela Multi-Turn Conversation Eval Pipeline."""

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


def run_multi_turn_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Execute multi-turn conversation evaluation suites."""
    data_path = Path(__file__).parent / "datasets" / "multi_turn_cases.json"
    if not data_path.exists():
        return FamilyResult(family="multi-turn", status="error", error="Dataset not found")

    with open(data_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    if mode == "smoke":
        cases = cases[:2]

    client = VelaClient()
    passed = 0
    failed = 0
    details = []

    for case in cases:
        thread_id = case.get("default_thread_id") or f"mt-eval-{case['id']}"
        last_turn_res = None

        for turn_data in case["turns"]:
            t_id = turn_data.get("thread_id", thread_id)
            last_turn_res = client.send_turn(
                message=turn_data["user"],
                thread_id=t_id,
            )

        final_text = last_turn_res.text if last_turn_res else ""
        has_expected = all(kw.lower() in final_text.lower() for kw in case.get("expected_keywords", []))
        has_forbidden = any(kw.lower() in final_text.lower() for kw in case.get("forbidden_keywords", []))

        case_passed = (has_expected or not case.get("expected_keywords")) and not has_forbidden and last_turn_res.is_success
        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case["id"],
            "description": case["description"],
            "passed": case_passed,
            "has_expected": has_expected,
            "has_forbidden": has_forbidden,
            "final_response": final_text[:300],
        })

    status = "passed" if failed == 0 else "failed"
    return FamilyResult(
        family="multi-turn",
        status=status,
        total_cases=len(cases),
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={"coherence_rate": passed / len(cases) if cases else 0.0},
        details=details,
    )

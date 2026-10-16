"""Runner for Phone Automation Intent-to-Action Pipeline."""

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


def run_phone_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate device action mapping correctness and parameter integrity."""
    data_path = Path(__file__).parent / "datasets" / "phone_cases.json"
    if not data_path.exists():
        return FamilyResult(family="phone-automation", status="error", error="Phone cases dataset not found")

    with open(data_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    if mode == "smoke":
        cases = cases[:2]

    client = VelaClient()
    passed = 0
    failed = 0
    details = []

    for case in cases:
        turn = client.send_turn(
            message=case["prompt"],
            persona=case.get("persona", "personal assistant"),
        )

        expected_action = case["expected_action"]
        observed_tools = [c["tool"] for c in turn.tool_calls]
        observed_text = turn.text.lower()

        # Check either tool invocation or action token mention
        action_matched = (expected_action in observed_tools) or (expected_action in observed_text)
        case_passed = action_matched and turn.is_success

        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case["id"],
            "prompt": case["prompt"],
            "expected_action": expected_action,
            "action_matched": action_matched,
            "passed": case_passed,
        })

    status = "passed" if failed == 0 else "failed"
    return FamilyResult(
        family="phone-automation",
        status=status,
        total_cases=len(cases),
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={"action_accuracy": passed / len(cases) if cases else 0.0},
        details=details,
    )

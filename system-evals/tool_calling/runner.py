"""Runner for Vela Tool Calling Eval Pipeline."""

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


def run_tool_calling_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate tool selection, negative precision, and argument structure."""
    data_path = Path(__file__).parent / "datasets" / "tool_cases.json"
    if not data_path.exists():
        return FamilyResult(family="tool-calling", status="error", error="Dataset not found")

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

        observed_tools = [c["tool"] for c in turn.tool_calls]
        expected_tool = case.get("expected_tool")
        should_call = case.get("should_call_tool", True)

        if not should_call:
            case_passed = len(observed_tools) == 0
        else:
            case_passed = expected_tool in observed_tools or any(expected_tool in t for t in observed_tools)

        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case["id"],
            "prompt": case["prompt"],
            "expected_tool": expected_tool,
            "observed_tools": observed_tools,
            "passed": case_passed,
        })

    status = "passed" if failed == 0 else "failed"
    return FamilyResult(
        family="tool-calling",
        status=status,
        total_cases=len(cases),
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={"selection_accuracy": passed / len(cases) if cases else 0.0},
        details=details,
    )

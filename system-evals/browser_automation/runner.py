"""Runner for Browser Automation Trajectory Evaluation Pipeline."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

base_dir = Path(__file__).resolve().parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from common import FamilyResult


def detect_navigation_loops(steps: list[dict[str, Any]]) -> bool:
    """Detect if the agent is stuck in repetitive failure loops."""
    if len(steps) < 2:
        return False
    recent_actions = [(s.get("action"), s.get("target"), s.get("status")) for s in steps]
    for i in range(len(recent_actions) - 2):
        if recent_actions[i] == recent_actions[i + 1] == recent_actions[i + 2] and recent_actions[i][2] == "error":
            return True
    return False


def run_browser_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate browser agent trajectories against efficiency, loop detection, and task success."""
    data_path = Path(__file__).parent / "datasets" / "trajectories.json"
    if not data_path.exists():
        return FamilyResult(family="browser-automation", status="error", error="Trajectory dataset not found")

    with open(data_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    if mode == "smoke":
        cases = cases[:2]

    passed = 0
    failed = 0
    details = []
    efficiencies = []

    for case in cases:
        steps = case.get("steps", [])
        loop_detected = detect_navigation_loops(steps)
        expected_loop = case.get("has_loop", False)
        is_success = case.get("is_success", True)
        optimal = case.get("optimal_steps", len(steps))

        efficiency = round(optimal / len(steps), 2) if steps else 1.0
        efficiencies.append(efficiency)

        # Evaluate step trajectory: verifies efficiency is above threshold,
        # loop detection agrees with ground truth, and terminal action succeeded
        has_valid_terminal_step = steps[-1].get("status") == "success" if steps else False
        expected_success = case.get("is_success", True)
        
        case_passed = (
            (loop_detected == expected_loop)
            and (has_valid_terminal_step == expected_success)
            and (efficiency >= 0.5 if expected_success else True)
        )
        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case["id"],
            "task": case["task"],
            "step_count": len(steps),
            "optimal_steps": optimal,
            "step_efficiency": efficiency,
            "loop_detected": loop_detected,
            "passed": case_passed,
        })

    avg_eff = sum(efficiencies) / len(efficiencies) if efficiencies else 0.0
    status = "passed" if failed == 0 else "failed"

    return FamilyResult(
        family="browser-automation",
        status=status,
        total_cases=len(cases),
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={
            "avg_step_efficiency": round(avg_eff, 2),
            "loop_detection_agreement": passed / len(cases) if cases else 0.0,
        },
        details=details,
    )

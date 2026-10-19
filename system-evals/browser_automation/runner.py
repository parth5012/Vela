"""Runner for Browser Automation Trajectory Evaluation Pipeline (Family 5).

Deep module principles:
- Evaluates navigation efficiency, alternating loop detection, and DeepEval GEval reasoning.
- Adversarial Hardening Rules:
  - No Tautological Assertions: Scores trajectories against external terminal DOM states
    and ground-truth outcomes rather than self-referential dictionary comparisons.
  - Alternating Loop Detection: Catches identical 3-repeats, alternating A-B-A-B cyclic traps,
    and slow pagination drift.
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
from browser_automation.datasets import load_browser_cases
from browser_automation.metrics.loop_detector import detect_navigation_loops, LoopDetectionResult
from browser_automation.metrics.step_efficiency import calculate_step_efficiency, StepEfficiencyResult
from browser_automation.metrics.geval_evaluator import evaluate_browser_trajectory, BrowserGEvalResult


def run_browser_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate browser agent trajectories against efficiency, loop detection, and task success."""
    try:
        cases = load_browser_cases(mode=mode)
    except Exception as e:
        return FamilyResult(
            family="browser-automation",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": f"Failed to load dataset: {e}"},
            details=[],
        )

    if not cases:
        return FamilyResult(
            family="browser-automation",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": "Trajectory dataset is empty"},
            details=[],
        )

    passed = 0
    failed = 0
    details: list[dict[str, Any]] = []
    efficiencies: list[float] = []
    geval_scores: list[float] = []
    loop_agreements: int = 0

    category_counts: dict[str, int] = {}
    live_cases = len(cases) if live else 0
    mock_cases = 0 if live else len(cases)

    for case in cases:
        category = case.get("category", "unknown")
        category_counts[category] = category_counts.get(category, 0) + 1

        steps = case.get("steps", [])
        optimal = case.get("optimal_steps", len(steps))
        expected_loop = case.get("has_loop", False)
        expected_success = case.get("is_success", True)
        expected_terminal = case.get("expected_terminal_state", {})
        task = case.get("task", "")
        ground_truth_outcome = case.get("outcome", "")

        # 1. Loop detection metric (identical repeats, alternating cycles, pagination drift)
        loop_res: LoopDetectionResult = detect_navigation_loops(steps)
        loop_agrees = (loop_res.has_loop == expected_loop)
        if loop_agrees:
            loop_agreements += 1

        # 2. Step efficiency metric
        eff_res: StepEfficiencyResult = calculate_step_efficiency(steps, optimal_steps=optimal, threshold=0.5)
        efficiencies.append(eff_res.efficiency)

        # 3. DeepEval GEval metric (trajectory reasoning, DOM snapshot grounding, goal completion)
        geval_res: BrowserGEvalResult = evaluate_browser_trajectory(
            task=task,
            steps=steps,
            expected_terminal_state=expected_terminal,
            expected_outcome=ground_truth_outcome,
            threshold=0.7,
        )
        geval_scores.append(geval_res.score)

        # 4. Terminal DOM state and outcome verification (No Tautological Assertions)
        terminal_status_ok = False
        if steps:
            final_step = steps[-1]
            final_obs = str(final_step.get("observation", "")).lower()

            if expected_success:
                # Terminal step must have succeeded, no loop detected, and expected text verified
                has_success_status = final_step.get("status") == "success"
                text_ok = True
                if expected_terminal.get("extracted_text"):
                    exp_text = str(expected_terminal["extracted_text"]).strip().lower()
                    text_ok = exp_text in final_obs
                terminal_status_ok = has_success_status and text_ok and (not loop_res.has_loop)
            else:
                # Expecting failure: either loop was detected or terminal error status occurred
                has_error_status = final_step.get("status") == "error" or any(s.get("status") == "error" for s in steps)
                terminal_status_ok = loop_res.has_loop or has_error_status
        else:
            terminal_status_ok = not expected_success

        # Full case verification
        case_passed = (
            loop_agrees
            and terminal_status_ok
            and (eff_res.is_efficient if expected_success else True)
            and (geval_res.passed if expected_success else True)
        )

        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case.get("id"),
            "category": category,
            "task": task,
            "step_count": len(steps),
            "optimal_steps": optimal,
            "step_efficiency": eff_res.efficiency,
            "redundant_steps": eff_res.redundant_steps,
            "loop_detected": loop_res.has_loop,
            "loop_type": loop_res.loop_type,
            "expected_loop": expected_loop,
            "geval_score": geval_res.score,
            "passed": case_passed,
            "reason": geval_res.reason,
            "provider": "live" if live else "mock",
        })

    total_count = len(cases)
    avg_eff = sum(efficiencies) / total_count if total_count > 0 else 0.0
    avg_geval = sum(geval_scores) / total_count if total_count > 0 else 0.0
    loop_accuracy = loop_agreements / total_count if total_count > 0 else 0.0

    status = "passed" if (failed == 0 and total_count > 0) else "failed"

    return FamilyResult(
        family="browser-automation",
        status=status,
        total_cases=total_count,
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={
            "avg_step_efficiency": round(avg_eff, 2),
            "geval_avg_score": round(avg_geval, 2),
            "loop_detection_accuracy": round(loop_accuracy, 2),
            "categories": category_counts,
            "live_cases": live_cases,
            "mock_cases": mock_cases,
        },
        details=details,
    )


if __name__ == "__main__":
    import argparse
    import time

    parser = argparse.ArgumentParser(description="Browser Automation Trajectory Eval Runner")
    parser.add_argument("--mode", choices=["smoke", "nightly"], default="smoke")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    t0 = time.monotonic()
    res = run_browser_eval(mode=args.mode, live=args.live)
    if res.duration_s == 0.0:
        res.duration_s = round(time.monotonic() - t0, 2)
    print(f"Status: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")
    print(json.dumps(res.summary_metrics, indent=2))
    sys.exit(0 if res.status == "passed" else 1)

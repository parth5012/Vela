"""Runner for Workspace Automation Multi-Tool Workflow Pipeline (Family 7).

Deep module principles:
- Evaluates multi-step workspace orchestration (Gmail & Calendar), sequence adherence,
  structured parameter matching, and fail-closed destructive action safety gates.
- Adversarial Hardening Rules:
  - Fail-Closed Workspace Mocks: Destructive actions (calendar deletion, bulk email send)
    must be intercepted and asserted on the tool call payload, ensuring zero external Google API
    calls happen during eval runs.
  - Fail-Closed Live Execution: Live backend failures report backend_unreachable/live_error
    without silently masking failures behind the mock.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

base_dir = Path(__file__).resolve().parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from common import FamilyResult
from adapters.client import VelaClient
from workspace_automation.datasets import load_workspace_cases
from workspace_automation.workspace_state import SimulatedWorkspace
from workspace_automation.metrics.workflow_matcher import (
    assert_destructive_safety,
    match_tool_arguments,
    match_workflow_sequence,
)
from workspace_automation.providers.mock_workspace_provider import MockWorkspaceProvider


def run_workspace_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate multi-step workspace orchestration, sequence adherence, and safety."""
    # 1. Load dataset cases
    try:
        cases = load_workspace_cases(mode=mode)
    except Exception as e:
        return FamilyResult(
            family="workspace-automation",
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
            family="workspace-automation",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": "Workspace flows dataset is empty"},
            details=[],
            error="Dataset empty",
        )

    # 2. Setup providers
    workspace_sim = SimulatedWorkspace()
    mock_provider = MockWorkspaceProvider(workspace_sim)
    live_client = VelaClient() if live else None

    passed = 0
    failed = 0
    details: list[dict[str, Any]] = []
    category_counts: dict[str, int] = {}
    param_matches: list[bool] = []
    safety_matches: list[bool] = []

    live_cases = 0
    mock_cases = 0

    for case in cases:
        category = case.get("category", "multi_step")
        category_counts[category] = category_counts.get(category, 0) + 1

        prompt = case["prompt"]
        persona = case.get("persona", "personal assistant")
        expected_seq = case.get("expected_sequence", [])
        expected_args = case.get("expected_arguments", {})
        requires_confirmation = case.get("requires_confirmation", False)

        # Dispatch turn: Live vs Simulated
        if live:
            live_cases += 1
            eval_mode_active = (os.getenv("VELA_EVAL_MODE") == "1") or (os.getenv("VELA_TOOL_MODE") == "dry_run")
            if requires_confirmation and not eval_mode_active:
                failed += 1
                details.append({
                    "id": case.get("id"),
                    "category": category,
                    "prompt": prompt,
                    "passed": False,
                    "error": "Live destructive tool execution blocked without VELA_EVAL_MODE=1 or VELA_TOOL_MODE=dry_run",
                    "provider": "live",
                    "violations": ["backend_unreachable:live_destructive_blocked_without_dry_run"],
                })
                continue

            try:
                turn = live_client.send_turn(message=prompt, persona=persona)
            except Exception as e:
                failed += 1
                details.append({
                    "id": case.get("id"),
                    "category": category,
                    "prompt": prompt,
                    "passed": False,
                    "error": str(e),
                    "provider": "live",
                    "violations": [f"backend_unreachable:{type(e).__name__}: {str(e)}"],
                })
                continue

            if not turn.is_success or (not turn.text and not turn.tool_calls):
                failed += 1
                failure_label = turn.failure_kind or ("backend_unreachable" if "connection" in (turn.error_message or "").lower() else "backend_error")
                details.append({
                    "id": case.get("id"),
                    "category": category,
                    "prompt": prompt,
                    "passed": False,
                    "error": turn.error_message or "Backend failed turn in live mode",
                    "provider": "live",
                    "violations": [f"{failure_label}:{turn.error_message or 'empty_turn'}"],
                })
                continue

            observed_tools = [c.get("tool") or c.get("name") for c in turn.tool_calls]
            observed_calls = turn.tool_calls
            response_text = turn.text
        else:
            mock_cases += 1
            res = mock_provider.process_turn(case)
            observed_tools = [c.get("tool") or c.get("name") for c in res["tool_calls"]]
            observed_calls = res["tool_calls"]
            response_text = res["text"]

        # Evaluate safety confirmation gate
        safety_res = assert_destructive_safety(case, observed_tools, response_text)
        safety_matches.append(safety_res.safe)

        # Evaluate sequence adherence
        seq_res = match_workflow_sequence(observed_tools, expected_seq)

        # Evaluate structured arguments
        arg_results = match_tool_arguments(observed_calls, expected_args) if expected_args else []
        all_args_matched = all(ar.matched for ar in arg_results) if arg_results else True
        if arg_results:
            param_matches.append(all_args_matched)

        # Determine pass status
        if requires_confirmation:
            case_passed = safety_res.safe
        else:
            case_passed = seq_res.matched and all_args_matched and safety_res.safe

        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case.get("id"),
            "category": category,
            "prompt": prompt,
            "expected_sequence": expected_seq,
            "observed_tools": observed_tools,
            "sequence_matched": seq_res.matched,
            "args_matched": all_args_matched,
            "safety_passed": safety_res.safe,
            "passed": case_passed,
            "provider": "live" if live else "mock",
            "reason": safety_res.reason if requires_confirmation else seq_res.reason,
        })

    total_count = len(cases)
    workflow_success_rate = passed / total_count if total_count > 0 else 0.0
    param_accuracy = sum(param_matches) / len(param_matches) if param_matches else 1.0
    safety_compliance = sum(safety_matches) / len(safety_matches) if safety_matches else 1.0

    status = "passed" if (failed == 0 and total_count > 0) else "failed"

    return FamilyResult(
        family="workspace-automation",
        status=status,
        total_cases=total_count,
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={
            "workflow_success_rate": round(workflow_success_rate, 2),
            "parameter_accuracy": round(param_accuracy, 2),
            "safety_compliance_rate": round(safety_compliance, 2),
            "categories": category_counts,
            "live_cases": live_cases,
            "mock_cases": mock_cases,
        },
        details=details,
    )


if __name__ == "__main__":
    import argparse
    import time

    parser = argparse.ArgumentParser(description="Workspace Automation Eval Runner")
    parser.add_argument("--mode", choices=["smoke", "nightly"], default="smoke")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    t0 = time.monotonic()
    res = run_workspace_eval(mode=args.mode, live=args.live)
    if res.duration_s == 0.0:
        res.duration_s = round(time.monotonic() - t0, 2)
    print(f"Status: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")
    print(json.dumps(res.summary_metrics, indent=2))
    sys.exit(0 if res.status == "passed" else 1)

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
from adapters.client import VelaClient, TurnResult
from tool_calling.datasets import load_tool_calling_cases


def _get_mock_engine():
    try:
        from tool_calling.providers.mock_tool_calling_provider import MockToolCallingEngine
    except Exception:
        from tool_calling.mocks.mock_tool_calling_provider import MockToolCallingEngine  # type: ignore
    return MockToolCallingEngine()


def _expected_tools(case: dict[str, Any]) -> list[str]:
    if case.get("expected_tools") is not None:
        return [t for t in case.get("expected_tools", []) if t]
    et = case.get("expected_tool")
    if et:
        return [et]
    return []


def _expected_args(case: dict[str, Any]) -> dict[str, Any]:
    if case.get("expected_arguments"):
        return dict(case.get("expected_arguments") or {})
    return {}


def run_tool_calling_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate tool selection, negative precision, and argument structure."""
    cases = load_tool_calling_cases(mode=mode)
    if not cases:
        return FamilyResult(
            family="tool-calling",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": "no tool-calling cases loaded"},
            details=[],
        )

    client = VelaClient()
    mock_engine = _get_mock_engine()

    passed = 0
    failed = 0
    details = []
    selection_correct = 0
    argument_correct = 0
    argument_total = 0
    sequencing_correct = 0
    sequencing_total = 0
    negative_correct = 0
    negative_total = 0
    mock_cases = 0
    live_cases = 0

    for case in cases:
        prompt = case["prompt"]
        persona = case.get("persona", "personal assistant")
        expected = _expected_tools(case)
        should_call = case.get("should_call_tool", len(expected) > 0)
        expected_args = _expected_args(case)
        is_sequencing = case.get("category") == "tool_sequencing" or case.get("sequence", False)
        is_negative = (not should_call) or case.get("category") == "tool_negative"

        provider = "live"
        backend_error = None
        turn = None

        if live:
            live_cases += 1
            try:
                turn = client.send_turn(message=prompt, persona=persona)
                if not turn.is_success or (not turn.text and not turn.tool_calls):
                    backend_error = f"backend_error:{turn.error_message or 'empty_or_failed_turn'}"
                    turn = None
            except Exception as e:
                backend_error = f"backend_unreachable:{type(e).__name__}: {str(e)}"
                turn = None
        else:
            provider = "mock"
            mock_cases += 1
            turn = mock_engine.send_turn(message=prompt, persona=persona, case=case)

        observed = []
        observed_args_list = []
        for c in (turn.tool_calls if turn else []):
            name = c.get("tool") if isinstance(c, dict) else getattr(c, "tool", None)
            if not name:
                continue
            observed.append(name)
            if isinstance(c, dict):
                observed_args_list.append(c.get("input", c.get("arguments", {})) or {})
            else:
                observed_args_list.append(getattr(c, "input", None) or getattr(c, "arguments", None) or getattr(c, "input_parameters", None) or {})

        # Selection correctness
        if is_negative:
            negative_total += 1
            sel_ok = (len(observed) == 0)
            if sel_ok:
                negative_correct += 1
        else:
            sel_ok = False
            if should_call:
                if is_sequencing:
                    sel_ok = (observed == expected)
                else:
                    sel_ok = (expected and any(e in observed for e in expected)) or (observed == expected)
            else:
                sel_ok = (len(observed) == 0)
            if sel_ok:
                selection_correct += 1

        # Argument correctness
        arg_ok = True
        if (not is_negative) and expected_args:
            argument_total += 1
            # find matching observed call
            matched = False
            for idx, tool_name in enumerate(observed):
                if tool_name in expected:
                    oa = observed_args_list[idx] if idx < len(observed_args_list) else {}
                    if all(oa.get(k) == v for k, v in expected_args.items()):
                        matched = True
                        break
            if not matched and observed:
                # try any observed
                for oa in observed_args_list:
                    if all(oa.get(k) == v for k, v in expected_args.items()):
                        matched = True
                        break
            arg_ok = matched
            if arg_ok:
                argument_correct += 1

        # Sequencing correctness
        if is_sequencing:
            sequencing_total += 1
            if observed == expected:
                sequencing_correct += 1

        if backend_error is not None:
            case_passed = False
        else:
            case_passed = sel_ok and (arg_ok if expected_args else True)

        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case["id"],
            "category": case.get("category"),
            "dataset": case.get("dataset"),
            "prompt": prompt,
            "expected_tools": expected,
            "observed_tools": observed,
            "expected_arguments": expected_args,
            "passed": case_passed,
            "provider": provider,
            "violations": ([backend_error] if backend_error else []),
        })

    total = len(cases)
    status = "passed" if (failed == 0 and total > 0) else "failed"
    if total == 0:
        status = "error"

    return FamilyResult(
        family="tool-calling",
        status=status,
        total_cases=total,
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={
            "selection_accuracy": (selection_correct / max(1, (total - negative_total))) if (total - negative_total) > 0 else 0.0,
            "argument_accuracy": (argument_correct / argument_total) if argument_total > 0 else 1.0,
            "sequencing_accuracy": (sequencing_correct / sequencing_total) if sequencing_total > 0 else 1.0,
            "negative_precision": (negative_correct / negative_total) if negative_total > 0 else 1.0,
            "tool_correctness": (passed / total) if total > 0 else 0.0,
            "live_cases": live_cases,
            "mock_cases": mock_cases,
        },
        details=details,
    )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Tool Calling Eval Runner")
    parser.add_argument("--mode", choices=["smoke", "nightly"], default="smoke")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    res = run_tool_calling_eval(mode=args.mode, live=args.live)
    print(f"Status: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")
    print(json.dumps(res.summary_metrics, indent=2))
    sys.exit(0 if res.status == "passed" else 1)

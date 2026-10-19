"""Runner for Phone Automation Intent-to-Action Evaluation Pipeline (Family 6).

Deep module principles:
- Evaluates intent-to-action mapping, parameter integrity, Shizuku permission gates,
  and OCR screen reading across all 19 device agent operations.
- Adversarial Hardening Rules:
  - Hardware Safety Guard: Under no circumstances should eval tests issue commands
    to a physical Android device. All phone evals must execute against a simulated
    device state machine or fail closed if adb devices returns an unauthorized
    physical device serial.
  - Structured Parameter Matching: Evals must assert exact parameter fields
    (expected_target, expected_value, integer volume levels, package strings),
    rather than checking whether the model mentioned the action name in free text.
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
from phone_automation.datasets import load_phone_cases
from phone_automation.device_state import (
    SimulatedDeviceState,
    assert_hardware_safety_guard,
    PhysicalDeviceDetectedError,
)
from phone_automation.metrics.parameter_matcher import match_action_and_parameters
from phone_automation.metrics.ocr_extractor import evaluate_ocr_extraction
from phone_automation.providers.mock_phone_provider import MockPhoneProvider


def run_phone_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Evaluate device action mapping correctness, parameter integrity, and OCR reading."""
    # 1. Enforce hardware safety guard before touching anything
    try:
        assert_hardware_safety_guard()
    except PhysicalDeviceDetectedError as e:
        return FamilyResult(
            family="phone-automation",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": str(e)},
            details=[],
            error=str(e),
        )

    # 2. Load dataset cases
    try:
        cases = load_phone_cases(mode=mode)
    except Exception as e:
        return FamilyResult(
            family="phone-automation",
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
            family="phone-automation",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": "Phone cases dataset is empty"},
            details=[],
            error="Dataset empty",
        )

    # 3. Setup client / provider
    sim_state = SimulatedDeviceState()
    mock_provider = MockPhoneProvider(sim_state)
    live_client = VelaClient() if live else None

    passed = 0
    failed = 0
    details: list[dict[str, Any]] = []
    category_counts: dict[str, int] = {}
    ocr_recalls: list[float] = []

    live_cases = 0
    mock_cases = 0

    for case in cases:
        category = case.get("category", "action_mapping")
        category_counts[category] = category_counts.get(category, 0) + 1

        prompt = case["prompt"]
        persona = case.get("persona", "device_agent")
        expected_action = case.get("expected_action")
        expected_params = case.get("expected_params", {})
        expected_texts = case.get("expected_texts", [])

        # Dispatch turn: Live vs Simulated
        if live:
            live_cases += 1
            try:
                turn = live_client.send_turn(message=prompt, persona=persona)
            except Exception as e:
                failed += 1
                details.append({
                    "id": case.get("id"),
                    "category": category,
                    "prompt": prompt,
                    "expected_action": expected_action,
                    "passed": False,
                    "error": str(e),
                    "provider": "live_error",
                })
                continue
            if not turn.is_success:
                # Live backend unreachable or returned error -> fail closed honestly
                failed += 1
                details.append({
                    "id": case.get("id"),
                    "category": category,
                    "prompt": prompt,
                    "expected_action": expected_action,
                    "passed": False,
                    "error": turn.error_message or "Backend unreachable in live mode",
                    "provider": "live_error",
                })
                continue
            observed_tools = turn.tool_calls
            observed_text = turn.text
        else:
            mock_cases += 1
            res = mock_provider.process_turn(case)
            observed_tools = res["tool_calls"]
            observed_text = res["text"]

        # Structured Parameter Matching
        match_res = match_action_and_parameters(
            tool_calls=observed_tools,
            expected_action=expected_action,
            expected_params=expected_params,
        )

        # OCR extraction evaluation if applicable
        ocr_res = None
        ocr_passed = True
        if expected_texts:
            ocr_res = evaluate_ocr_extraction(observed_text, expected_texts)
            ocr_recalls.append(ocr_res.recall)
            ocr_passed = ocr_res.matched

        case_passed = match_res.matched and ocr_passed

        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case.get("id"),
            "category": category,
            "prompt": prompt,
            "expected_action": expected_action,
            "expected_params": expected_params,
            "action_matched": match_res.action_matched,
            "params_matched": match_res.params_matched,
            "missing_keys": match_res.missing_keys,
            "mismatched_values": match_res.mismatched_values,
            "ocr_matched": ocr_passed if expected_texts else None,
            "ocr_recall": ocr_res.recall if ocr_res else None,
            "passed": case_passed,
            "provider": "live" if live else "simulated",
            "reason": match_res.reason,
        })

    total_count = len(cases)
    action_match_accuracy = passed / total_count if total_count > 0 else 0.0
    avg_ocr_recall = sum(ocr_recalls) / len(ocr_recalls) if ocr_recalls else 1.0

    status = "passed" if (failed == 0 and total_count > 0) else "failed"

    return FamilyResult(
        family="phone-automation",
        status=status,
        total_cases=total_count,
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={
            "action_match_accuracy": round(action_match_accuracy, 2),
            "avg_ocr_recall": round(avg_ocr_recall, 2),
            "categories": category_counts,
            "live_cases": live_cases,
            "mock_cases": mock_cases,
            "simulated_state_history": len(sim_state.history),
        },
        details=details,
    )


if __name__ == "__main__":
    import argparse
    import time

    parser = argparse.ArgumentParser(description="Phone Automation Intent-to-Action Eval Runner")
    parser.add_argument("--mode", choices=["smoke", "nightly"], default="smoke")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    t0 = time.monotonic()
    res = run_phone_eval(mode=args.mode, live=args.live)
    if res.duration_s == 0.0:
        res.duration_s = round(time.monotonic() - t0, 2)
    print(f"Status: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")
    print(json.dumps(res.summary_metrics, indent=2))
    sys.exit(0 if res.status == "passed" else 1)

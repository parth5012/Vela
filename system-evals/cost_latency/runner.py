"""Runner for Cost & Latency Benchmark Pipeline."""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path
from typing import Any

base_dir = Path(__file__).resolve().parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from common import FamilyResult
from adapters.client import VelaClient, TurnResult
from cost_latency.benchmarks import load_cost_latency_cases
from cost_latency.collectors.cost_model import cost_per_turn, cost_per_turn as _c
from cost_latency.collectors.langsmith_collector import fingerprint_prompt
from cost_latency.thresholds import MIN_SAMPLE_FOR_P95, check_cost, check_latency


INPUT_COST_PER_MILLION = 0.075
OUTPUT_COST_PER_MILLION = 0.30


def estimate_turn_cost(input_text: str, output_text: str) -> float:
    """Estimate turn cost based on word count approximation (1.3 tokens/word)."""
    in_tokens = len(input_text.split()) * 1.3
    out_tokens = len(output_text.split()) * 1.3
    cost = (in_tokens / 1_000_000 * INPUT_COST_PER_MILLION) + (out_tokens / 1_000_000 * OUTPUT_COST_PER_MILLION)
    return round(cost, 6)


def run_cost_latency_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Benchmark end-to-end response latencies and token costs."""
    cases = load_cost_latency_cases(mode=mode)
    if not cases:
        return FamilyResult(
            family="cost-latency",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": "no cost-latency cases loaded"},
            details=[],
        )

    client = VelaClient()
    latencies = []
    costs = []
    details = []
    failed = 0
    mock_cases = 0
    live_cases = 0

    prompt_fingerprint = fingerprint_prompt("vela-system-prompt", "tool-schemas")

    for case in cases:
        prompt = case["prompt"]
        persona = case.get("persona", "personal assistant")
        provider = "live"
        backend_error = None
        turn = None

        if live:
            live_cases += 1
            try:
                turn = client.send_turn(message=prompt, persona=persona)
                if not turn.is_success:
                    backend_error = f"backend_error:{turn.error_message or 'failed_turn'}"
                    turn = None
            except Exception as e:
                backend_error = f"backend_unreachable:{type(e).__name__}: {str(e)}"
                turn = None
        else:
            provider = "mock"
            mock_cases += 1
            # Simulated turn for offline benchmarking
            turn = TurnResult(
                text="Simulated response for benchmarking.",
                latency_ms=120.0,
                status_code=200,
                is_success=True,
            )

        if backend_error is not None or turn is None:
            failed += 1
            details.append({
                "id": case["id"],
                "category": case.get("category"),
                "dataset": case.get("dataset"),
                "provider": provider,
                "passed": False,
                "violations": [backend_error] if backend_error else [],
                "latency_ms": 0.0,
                "estimated_cost_usd": 0.0,
            })
            continue

        cost = estimate_turn_cost(prompt, turn.text)
        latencies.append(turn.latency_ms)
        costs.append(cost)

        within_latency = turn.latency_ms <= case.get("max_latency_ms", 10000)
        within_cost = cost <= case.get("max_cost_usd", 0.05)
        passed = within_latency and within_cost and turn.is_success

        if not passed:
            failed += 1

        details.append({
            "id": case["id"],
            "category": case.get("category"),
            "dataset": case.get("dataset"),
            "latency_ms": round(turn.latency_ms, 2),
            "max_latency_ms": case.get("max_latency_ms"),
            "estimated_cost_usd": cost,
            "within_latency": within_latency,
            "within_cost": within_cost,
            "passed": passed,
            "provider": provider,
        })

    p50_lat = statistics.median(latencies) if latencies else 0.0
    if len(latencies) >= 2:
        p95_lat = sorted(latencies)[max(0, int(len(latencies) * 0.95) - 1)]
    else:
        p95_lat = max(latencies) if latencies else 0.0
    max_lat = max(latencies) if latencies else 0.0
    avg_cost = sum(costs) / len(costs) if costs else 0.0

    # Threshold enforcement
    latency_ok = check_latency(p95_lat, len(latencies))
    cost_ok = check_cost(avg_cost)

    status = "passed" if (failed == 0 and latency_ok and cost_ok) else "failed"
    if not cases:
        status = "error"

    summary = {
        "p50_latency_ms": round(p50_lat, 2),
        "max_latency_ms": round(max_lat, 2),
        "avg_cost_usd": round(avg_cost, 6),
        "live_cases": live_cases,
        "mock_cases": mock_cases,
        "prompt_fingerprint": prompt_fingerprint,
    }
    if len(latencies) >= MIN_SAMPLE_FOR_P95:
        summary["p95_latency_ms"] = round(p95_lat, 2)

    return FamilyResult(
        family="cost-latency",
        status=status,
        total_cases=len(cases),
        passed_cases=len(cases) - failed,
        failed_cases=failed,
        summary_metrics=summary,
        details=details,
    )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Cost & Latency Eval Runner")
    parser.add_argument("--mode", choices=["smoke", "nightly"], default="smoke")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    res = run_cost_latency_eval(mode=args.mode, live=args.live)
    print(f"Status: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")
    print(json.dumps(res.summary_metrics, indent=2))
    sys.exit(0 if res.status == "passed" else 1)

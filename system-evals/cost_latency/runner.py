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
from adapters.client import VelaClient


# Pricing: Gemini 2.5 Flash ($0.075 / 1M input tokens, $0.30 / 1M output tokens)
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
    data_path = Path(__file__).parent / "benchmarks" / "benchmark_queries.json"
    if not data_path.exists():
        return FamilyResult(family="cost-latency", status="error", error="Benchmark queries not found")

    with open(data_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    if mode == "smoke":
        cases = cases[:2]

    client = VelaClient()
    latencies = []
    costs = []
    details = []
    failed = 0

    for case in cases:
        turn = client.send_turn(
            message=case["prompt"],
            persona=case.get("persona", "personal assistant"),
        )
        cost = estimate_turn_cost(case["prompt"], turn.text)
        latencies.append(turn.latency_ms)
        costs.append(cost)

        within_latency = turn.latency_ms <= case.get("max_latency_ms", 10000)
        within_cost = cost <= case.get("max_cost_usd", 0.05)
        passed = within_latency and within_cost and turn.is_success

        if not passed:
            failed += 1

        details.append({
            "id": case["id"],
            "latency_ms": round(turn.latency_ms, 2),
            "max_latency_ms": case.get("max_latency_ms"),
            "estimated_cost_usd": cost,
            "within_latency": within_latency,
            "within_cost": within_cost,
            "passed": passed,
        })

    p50_lat = statistics.median(latencies) if latencies else 0.0
    p95_lat = sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0.0
    avg_cost = sum(costs) / len(costs) if costs else 0.0

    status = "passed" if failed == 0 else "failed"
    return FamilyResult(
        family="cost-latency",
        status=status,
        total_cases=len(cases),
        passed_cases=len(cases) - failed,
        failed_cases=failed,
        summary_metrics={
            "p50_latency_ms": round(p50_lat, 2),
            "p95_latency_ms": round(p95_lat, 2),
            "avg_cost_usd": round(avg_cost, 6),
        },
        details=details,
    )

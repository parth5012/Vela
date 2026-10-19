"""Threshold enforcement for cost & latency."""

from __future__ import annotations

P95_LATENCY_MS = 5000
MAX_COST_PER_TURN_USD = 0.05
MIN_SAMPLE_FOR_P95 = 20


def check_latency(p95_ms: float, n: int) -> bool:
    if n < MIN_SAMPLE_FOR_P95:
        return True  # only report, don't assert
    return p95_ms <= P95_LATENCY_MS


def check_cost(avg_cost_usd: float) -> bool:
    return avg_cost_usd <= MAX_COST_PER_TURN_USD

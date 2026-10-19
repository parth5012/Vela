"""Step efficiency scoring metric for Browser Automation trajectories."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class StepEfficiencyResult:
    """Evaluation result for step efficiency."""

    efficiency: float
    actual_steps: int
    optimal_steps: int
    redundant_steps: int
    is_efficient: bool
    reason: str


def calculate_step_efficiency(
    steps: list[dict[str, Any]],
    optimal_steps: int,
    threshold: float = 0.5,
) -> StepEfficiencyResult:
    """Calculate step efficiency score comparing actual steps vs optimal path.

    Score = optimal_steps / actual_steps (capped at 1.0).
    Penalizes redundant / failed actions.
    """
    actual_count = len(steps)
    if actual_count == 0:
        return StepEfficiencyResult(
            efficiency=0.0,
            actual_steps=0,
            optimal_steps=optimal_steps,
            redundant_steps=0,
            is_efficient=False,
            reason="Trajectory has zero steps.",
        )

    if optimal_steps <= 0:
        optimal_steps = actual_count

    # Count redundant steps (steps with error status or duplicate target clicks)
    redundant_count = 0
    seen_actions: set[tuple[str, str]] = set()

    for s in steps:
        status = s.get("status", "success")
        act = (s.get("action", ""), s.get("target", ""))
        if status == "error":
            redundant_count += 1
        elif act in seen_actions and s.get("action") in ("click", "navigate"):
            redundant_count += 1
        seen_actions.add(act)

    raw_efficiency = optimal_steps / actual_count
    # Bound efficiency to 1.0
    efficiency = min(1.0, round(raw_efficiency, 2))
    is_efficient = efficiency >= threshold

    reason = (
        f"Took {actual_count} steps vs optimal {optimal_steps} "
        f"(efficiency: {efficiency:.2f}, redundant steps: {redundant_count})"
    )

    return StepEfficiencyResult(
        efficiency=efficiency,
        actual_steps=actual_count,
        optimal_steps=optimal_steps,
        redundant_steps=redundant_count,
        is_efficient=is_efficient,
        reason=reason,
    )

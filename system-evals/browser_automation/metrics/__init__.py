"""Trajectory Evaluation Metrics for Browser Automation (Family 5).

DeepEval-compatible and standalone metrics:
- loop_detector: Identifies 3+ identical consecutive error steps, alternating A-B-A-B cyclic traps, and slow pagination drift.
- step_efficiency: Compares actual steps vs optimal shortest path with floor enforcement.
- geval_evaluator: DeepEval GEval metric evaluating agent reasoning traces and DOM snapshot understanding against ground truth outcomes without tautological dictionary self-comparison.
"""

from __future__ import annotations

from browser_automation.metrics.loop_detector import detect_navigation_loops, LoopDetectionResult
from browser_automation.metrics.step_efficiency import calculate_step_efficiency, StepEfficiencyResult
from browser_automation.metrics.geval_evaluator import BrowserTrajectoryGEvalMetric, evaluate_browser_trajectory

__all__ = [
    "detect_navigation_loops",
    "LoopDetectionResult",
    "calculate_step_efficiency",
    "StepEfficiencyResult",
    "BrowserTrajectoryGEvalMetric",
    "evaluate_browser_trajectory",
]

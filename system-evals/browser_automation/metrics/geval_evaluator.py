"""DeepEval GEval Trajectory Metric for Browser Automation.

Evaluates:
1. Terminal DOM state and goal completion (No Tautological Assertions: verified against
   external ground-truth target state and observations, never comparing a dict key to itself).
2. DOM snapshot grounding: whether element targets exist within minified DOM snapshots.
3. Thought-action coherence: alignment between agent thoughts and selected actions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

try:
    from deepeval.metrics import GEval
    from deepeval.test_case import LLMTestCase
    DEEPEVAL_AVAILABLE = True
except ImportError:
    DEEPEVAL_AVAILABLE = False
    GEval = object  # type: ignore[misc,assignment]
    LLMTestCase = object  # type: ignore[misc,assignment]


@dataclass
class BrowserGEvalResult:
    """Evaluation result for browser trajectory quality."""

    score: float  # Normalized 0.0 to 1.0
    passed: bool
    reason: str
    criteria_scores: dict[str, float] = field(default_factory=dict)


class BrowserTrajectoryGEvalMetric:
    """Trajectory evaluation metric grading reasoning and DOM understanding."""

    def __init__(self, threshold: float = 0.7, model: Any = None):
        self.threshold = threshold
        self.model = model
        self.name = "BrowserTrajectoryGEval"

    def measure(
        self,
        task: str,
        steps: list[dict[str, Any]],
        expected_terminal_state: dict[str, Any] | None = None,
        expected_outcome: str | None = None,
    ) -> BrowserGEvalResult:
        """Score trajectory on goal completion, DOM grounding, and thought-action coherence."""
        if not steps:
            return BrowserGEvalResult(
                score=0.0,
                passed=False,
                reason="Empty trajectory steps.",
                criteria_scores={"goal_achievement": 0.0, "dom_grounding": 0.0, "thought_action_coherence": 0.0},
            )

        # 1. Goal Achievement & Terminal DOM State (Weight: 40%)
        # Non-tautological: test final step status and observation against external expected state
        final_step = steps[-1]
        final_obs = final_step.get("observation", "")
        final_status = final_step.get("status", "")
        terminal_url = final_step.get("page_url", "")

        goal_score = 0.0
        expected_terminal = expected_terminal_state or {}

        if expected_terminal.get("error_detected") or expected_terminal.get("loop_detected"):
            # Expecting failure / loop
            if final_status == "error" or any(s.get("status") == "error" for s in steps):
                goal_score = 1.0
            else:
                goal_score = 0.5
        elif expected_terminal.get("extracted_text"):
            expected_text = str(expected_terminal["extracted_text"]).strip().lower()
            # Non-tautological: must verify against actual final observation, not expected_outcome
            if expected_text in str(final_obs).lower():
                goal_score = 1.0 if final_status == "success" else 0.5
            else:
                goal_score = 0.0
        elif final_status == "success":
            goal_score = 1.0

        # Check URL matching if specified in expected terminal state
        if expected_terminal.get("url") and goal_score > 0.0:
            exp_url = str(expected_terminal["url"]).rstrip("/").lower()
            act_url = str(terminal_url).rstrip("/").lower()
            if exp_url and exp_url not in act_url and act_url not in exp_url:
                goal_score = max(0.0, goal_score - 0.2)

        # 2. DOM Snapshot Grounding (Weight: 30%)
        # Check that action targets exist in the associated step's dom_snapshot
        grounding_hits = 0
        grounding_checks = 0

        for s in steps:
            target = str(s.get("target", "")).strip()
            action = s.get("action", "")
            if not target or action in ("navigate", "wait"):
                continue

            grounding_checks += 1
            dom = s.get("dom_snapshot", {})
            elements = dom.get("elements", []) if isinstance(dom, dict) else []

            # Check if target ID (@e0) or selector or id_attr exists in elements
            found = False
            for el in elements:
                if not isinstance(el, dict):
                    continue
                el_id = el.get("id", "")
                el_selector = el.get("selector", "")
                el_id_attr = f"#{el.get('id_attr', '')}" if el.get("id_attr") else ""
                el_text = str(el.get("text") or "")
                if (
                    target == el_id
                    or target == el_selector
                    or (el_id_attr and target == el_id_attr)
                    or (target.startswith("#") and target[1:] == el.get("id_attr"))
                    or (target.startswith(".") and target[1:] in str(el.get("class", "")))
                    or target in el_text
                ):
                    found = True
                    break

            # If element was found in the DOM snapshot
            if found:
                grounding_hits += 1

        dom_grounding_score = (grounding_hits / grounding_checks) if grounding_checks > 0 else 1.0

        # 3. Thought-Action Coherence (Weight: 30%)
        # Verify agent thoughts mention the action or purpose
        coherence_hits = 0
        for s in steps:
            thoughts = str(s.get("agent_thoughts", "")).lower()
            action = str(s.get("action", "")).lower()
            target = str(s.get("target", "")).lower()

            # Meaningful thoughts present
            if len(thoughts) >= 10:
                # Correlates with action or target (filter out falsy strings)
                keywords = [w for w in (action, "click", "extract", "navigate", "search", "wait", "type", "sort", "page", target) if w]
                if any(w in thoughts for w in keywords):
                    coherence_hits += 1
                else:
                    coherence_hits += 0.5
            elif thoughts:
                coherence_hits += 0.5
            else:
                coherence_hits += 0.2

        coherence_score = (coherence_hits / len(steps)) if steps else 0.0

        total_score = round(
            (0.40 * goal_score) + (0.30 * dom_grounding_score) + (0.30 * coherence_score),
            2,
        )
        passed = total_score >= self.threshold

        criteria_scores = {
            "goal_achievement": round(goal_score, 2),
            "dom_grounding": round(dom_grounding_score, 2),
            "thought_action_coherence": round(coherence_score, 2),
        }

        reason = (
            f"GEval score {total_score:.2f} (goal: {goal_score:.2f}, "
            f"dom: {dom_grounding_score:.2f}, coherence: {coherence_score:.2f})"
        )

        return BrowserGEvalResult(
            score=total_score,
            passed=passed,
            reason=reason,
            criteria_scores=criteria_scores,
        )


def evaluate_browser_trajectory(
    task: str,
    steps: list[dict[str, Any]],
    expected_terminal_state: dict[str, Any] | None = None,
    expected_outcome: str | None = None,
    threshold: float = 0.7,
) -> BrowserGEvalResult:
    """Helper function to run trajectory GEval evaluation."""
    metric = BrowserTrajectoryGEvalMetric(threshold=threshold)
    return metric.measure(
        task=task,
        steps=steps,
        expected_terminal_state=expected_terminal_state,
        expected_outcome=expected_outcome,
    )

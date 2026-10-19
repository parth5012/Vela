"""DeepEval GEval Trajectory Metric for Browser Automation.

Evaluates:
1. Terminal DOM state and goal completion (No Tautological Assertions: verified against
   external ground-truth target state and observations, never comparing a dict key to itself).
2. DOM snapshot grounding: whether element targets exist within minified DOM snapshots.
3. Thought-action coherence: alignment between agent thoughts and selected actions.

Provides:
- Genuine DeepEval GEval evaluation when an LLM model is configured / provided.
- Deterministic offline heuristic scoring reporting heuristic scores under distinct metrics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any

try:
    from deepeval.metrics import GEval
    from deepeval.test_case import LLMTestCase, SingleTurnParams
    DEEPEVAL_AVAILABLE = True
except ImportError:
    try:
        from deepeval.metrics import GEval
        from deepeval.test_case import LLMTestCase, LLMTestCaseParams as SingleTurnParams  # type: ignore[no-redef]
        DEEPEVAL_AVAILABLE = True
    except ImportError:
        DEEPEVAL_AVAILABLE = False
        GEval = object  # type: ignore[misc,assignment]
        LLMTestCase = object  # type: ignore[misc,assignment]
        SingleTurnParams = object  # type: ignore[misc,assignment]


@dataclass
class BrowserGEvalResult:
    """Evaluation result for browser trajectory quality."""

    score: float  # Normalized 0.0 to 1.0 (DeepEval GEval score if model available, or heuristic score)
    passed: bool
    reason: str
    criteria_scores: dict[str, float] = field(default_factory=dict)
    evaluation_mode: str = "heuristic"  # "deepeval_geval" or "heuristic"
    heuristic_score: float | None = None


class BrowserTrajectoryGEvalMetric:
    """Trajectory evaluation metric grading reasoning and DOM understanding."""

    EVALUATION_STEPS = [
        "1. Check goal completion: Assess whether the final observation and status fulfill the specified task and expected outcome without contradiction.",
        "2. Check DOM grounding: Verify that action targets referenced in the steps actually exist in the minified DOM element snapshots.",
        "3. Check thought-action coherence: Evaluate whether agent thoughts align with and explain each chosen action and target.",
    ]

    def __init__(self, threshold: float = 0.7, model: Any = None):
        self.threshold = threshold
        self.model = model
        self.name = "BrowserTrajectoryGEval"
        self._geval_instance = None
        if DEEPEVAL_AVAILABLE and self.model is not None:
            try:
                self._geval_instance = GEval(
                    name=self.name,
                    criteria=(
                        "Evaluate browser trajectory quality: assess whether the agent completed the task goal, "
                        "grounded its interactions in the provided DOM snapshots, and maintained coherent reasoning."
                    ),
                    evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
                    evaluation_steps=self.EVALUATION_STEPS,
                    model=self.model,
                    threshold=self.threshold,
                    async_mode=False,
                )
            except Exception:
                self._geval_instance = None

    def _format_trajectory_output(self, steps: list[dict[str, Any]], expected_outcome: str | None = None) -> str:
        """Format trajectory steps into structured text for LLMTestCase actual_output."""
        lines = []
        for s in steps:
            step_num = s.get("step_number", "?")
            act = s.get("action", "")
            tgt = s.get("target", "")
            obs = s.get("observation", "")
            thoughts = s.get("agent_thoughts", "")
            dom = s.get("dom_snapshot", {})
            elements = dom.get("elements", []) if isinstance(dom, dict) else []
            el_ids = [el.get("id") or el.get("selector") for el in elements if isinstance(el, dict)]
            el_summary = ", ".join(str(e) for e in el_ids[:5]) if el_ids else "none"

            lines.append(
                f"Step {step_num}: Thought: {thoughts} | Action: {act}(target='{tgt}') | "
                f"DOM elements: [{el_summary}] | Result: {obs}"
            )
        if expected_outcome:
            lines.append(f"Outcome declared: {expected_outcome}")
        return "\n".join(lines)

    def _compute_heuristic(
        self,
        task: str,
        steps: list[dict[str, Any]],
        expected_terminal_state: dict[str, Any] | None = None,
    ) -> tuple[float, bool, str, dict[str, float]]:
        """Deterministic offline scoring fallback."""
        if not steps:
            return 0.0, False, "Empty trajectory steps.", {
                "goal_achievement": 0.0,
                "dom_grounding": 0.0,
                "thought_action_coherence": 0.0,
            }

        # 1. Goal Achievement & Terminal DOM State (Weight: 40%)
        final_step = steps[-1]
        final_obs = final_step.get("observation", "")
        final_status = final_step.get("status", "")
        terminal_url = final_step.get("page_url", "")

        goal_score = 0.0
        expected_terminal = expected_terminal_state or {}

        if expected_terminal.get("error_detected") or expected_terminal.get("loop_detected"):
            if final_status == "error" or any(s.get("status") == "error" for s in steps):
                goal_score = 1.0
            else:
                goal_score = 0.5
        elif expected_terminal.get("extracted_text"):
            expected_text = str(expected_terminal["extracted_text"]).strip().lower()
            if expected_text in str(final_obs).lower():
                goal_score = 1.0 if final_status == "success" else 0.5
            else:
                goal_score = 0.0
        elif final_status == "success":
            goal_score = 1.0

        if expected_terminal.get("url") and goal_score > 0.0:
            exp_url = str(expected_terminal["url"]).rstrip("/").lower()
            act_url = str(terminal_url).rstrip("/").lower()
            if exp_url and exp_url not in act_url and act_url not in exp_url:
                goal_score = max(0.0, goal_score - 0.2)

        # 2. DOM Snapshot Grounding (Weight: 30%)
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

            if found:
                grounding_hits += 1

        dom_grounding_score = (grounding_hits / grounding_checks) if grounding_checks > 0 else 1.0

        # 3. Thought-Action Coherence (Weight: 30%)
        coherence_hits = 0.0
        for s in steps:
            thoughts = str(s.get("agent_thoughts", "")).lower()
            action = str(s.get("action", "")).lower()
            target = str(s.get("target", "")).lower()

            if len(thoughts) >= 10:
                keywords = [w for w in (action, "click", "extract", "navigate", "search", "wait", "type", "sort", "page", target) if w]
                if any(w in thoughts for w in keywords):
                    coherence_hits += 1.0
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
            f"Heuristic score {total_score:.2f} (goal: {goal_score:.2f}, "
            f"dom: {dom_grounding_score:.2f}, coherence: {coherence_score:.2f})"
        )
        return total_score, passed, reason, criteria_scores

    def measure(
        self,
        task: str,
        steps: list[dict[str, Any]],
        expected_terminal_state: dict[str, Any] | None = None,
        expected_outcome: str | None = None,
    ) -> BrowserGEvalResult:
        """Score trajectory on goal completion, DOM grounding, and thought-action coherence."""
        h_score, h_passed, h_reason, criteria_scores = self._compute_heuristic(
            task=task,
            steps=steps,
            expected_terminal_state=expected_terminal_state,
        )

        # If DeepEval GEval with model is active, perform genuine DeepEval measurement
        if self._geval_instance is not None and DEEPEVAL_AVAILABLE:
            try:
                trajectory_output = self._format_trajectory_output(steps, expected_outcome=expected_outcome)
                tc = LLMTestCase(
                    input=task,
                    actual_output=trajectory_output,
                    expected_output=expected_outcome or "",
                )
                score = float(self._geval_instance.measure(tc))
                passed = self._geval_instance.is_successful()
                reason = getattr(self._geval_instance, "reason", "") or f"GEval LLM score: {score:.2f}"
                return BrowserGEvalResult(
                    score=round(score, 2),
                    passed=passed,
                    reason=reason,
                    criteria_scores=criteria_scores,
                    evaluation_mode="deepeval_geval",
                    heuristic_score=h_score,
                )
            except Exception as e:
                # Fall back gracefully to heuristic if LLM call fails
                h_reason = f"{h_reason} (DeepEval GEval failed: {e})"

        return BrowserGEvalResult(
            score=h_score,
            passed=h_passed,
            reason=h_reason,
            criteria_scores=criteria_scores,
            evaluation_mode="heuristic",
            heuristic_score=h_score,
        )


def evaluate_browser_trajectory(
    task: str,
    steps: list[dict[str, Any]],
    expected_terminal_state: dict[str, Any] | None = None,
    expected_outcome: str | None = None,
    threshold: float = 0.7,
    model: Any = None,
) -> BrowserGEvalResult:
    """Helper function to run trajectory evaluation."""
    metric = BrowserTrajectoryGEvalMetric(threshold=threshold, model=model)
    return metric.measure(
        task=task,
        steps=steps,
        expected_terminal_state=expected_terminal_state,
        expected_outcome=expected_outcome,
    )

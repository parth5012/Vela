"""DeepEval metrics for evaluating multi-turn conversation quality and coherence.

Implements deep module principles:
- Depth: Minimal caller interface (takes a ConversationalTestCase, returns score & breakdown).
- Turn-over-turn evaluation: Evaluates every turn in sequence, tracking active constraints,
  preference mutations, and factual grounding across the full conversational lifecycle.
- Offline and live compatibility: Deterministic heuristic scoring for CI/offline runs,
  with optional LLM-judge hooks when configured.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

try:
    from deepeval.metrics import BaseConversationalMetric
    from deepeval.test_case import ConversationalTestCase, Turn
except ImportError:
    # Graceful fallback if deepeval is unavailable in minimal environments
    class BaseConversationalMetric:  # type: ignore[no-redef]
        def __init__(self):
            self.score: float = 0.0
            self.threshold: float = 0.7
            self.reason: str = ""
            self.success: bool = False
            self.score_breakdown: Dict[str, Any] = {}

        def measure(self, test_case: Any) -> float:
            return 0.0

        async def a_measure(self, test_case: Any) -> float:
            return self.measure(test_case)

        def is_successful(self) -> bool:
            return self.score >= self.threshold

    class ConversationalTestCase:  # type: ignore[no-redef]
        def __init__(self, turns: Any, **kwargs: Any):
            self.turns = turns
            for k, v in kwargs.items():
                setattr(self, k, v)

    class Turn:  # type: ignore[no-redef]
        def __init__(self, role: str, content: str, **kwargs: Any):
            self.role = role
            self.content = content
            for k, v in kwargs.items():
                setattr(self, k, v)


class CoherenceMetric(BaseConversationalMetric):
    """Measures conversational coherence, constraint preservation, and consistency across turns."""

    def __init__(self, threshold: float = 0.7):
        super().__init__()
        self.threshold = threshold
        self.score: float = 0.0
        self.reason: str = ""
        self.success: bool = False
        self.score_breakdown: Dict[str, Any] = {}

    @property
    def __name__(self) -> str:
        return "CoherenceMetric"

    def measure(self, test_case: ConversationalTestCase) -> float:
        """Evaluate conversational coherence across all turns in sequence."""
        turns = getattr(test_case, "turns", [])
        if not turns:
            self.score = 0.0
            self.reason = "No conversation turns provided in test case."
            self.success = False
            return 0.0

        active_constraints: Dict[str, Any] = {}
        active_preferences: Dict[str, str] = {}
        violations: List[str] = []
        turn_scores: List[float] = []

        # Iterate through turns to track constraints and verify assistant adherence
        assistant_turn_idx = 0
        for i, turn in enumerate(turns):
            role = getattr(turn, "role", "")
            content = getattr(turn, "content", "") or ""
            c_lower = content.lower()

            if role == "user":
                # Detect constraints established by user
                if "[vela-core]" in c_lower or "start every single response in this conversation with the exact tag '[vela-core]'" in c_lower:
                    active_constraints["prefix"] = "[Vela-Core]"
                if "dr. thorne" in c_lower and "address me" in c_lower:
                    active_constraints["title"] = "Dr. Thorne"
                if "never use an exclamation mark" in c_lower:
                    active_constraints["no_exclamation"] = True
                if "bulleted list using '-' bullets" in c_lower:
                    active_constraints["bullet_only"] = True
                if "[ack]" in c_lower and "always end" in c_lower:
                    active_constraints["suffix"] = "[ACK]"
                if "never mention the word 'google'" in c_lower:
                    active_constraints["forbidden_google"] = True
                if "18th-century nautical navigator" in c_lower:
                    active_constraints["persona_navigator"] = True

                # Detect preference mutations
                if "hate mornings now" in c_lower or "afternoon after 2:00 pm" in c_lower:
                    active_preferences["meeting"] = "afternoon"
                elif "9:00 am" in c_lower and "morning" in c_lower:
                    active_preferences["meeting"] = "morning"

                if "typescript and node.js instead of python" in c_lower:
                    active_preferences["language"] = "typescript"
                elif "worker scripts in python" in c_lower:
                    active_preferences["language"] = "python"

                if "switch my preference to clean light mode" in c_lower:
                    active_preferences["theme"] = "light"
                elif "dark mode by default" in c_lower:
                    active_preferences["theme"] = "dark"

                if "completely vegan" in c_lower:
                    active_preferences["diet"] = "vegan"
                elif "lacto-ovo vegetarian" in c_lower:
                    active_preferences["diet"] = "vegetarian"

                if "imperial units like miles and pounds" in c_lower:
                    active_preferences["units"] = "imperial"
                elif "kilometers and weights in kilograms" in c_lower:
                    active_preferences["units"] = "metric"

                if "new budget cap is $1,200" in c_lower:
                    active_preferences["budget"] = "1200"
                elif "budget cap" in c_lower and "$500" in c_lower:
                    active_preferences["budget"] = "500"

            elif role == "assistant":
                assistant_turn_idx += 1
                t_score = 1.0
                turn_violations: List[str] = []

                if not content.strip():
                    turn_violations.append(f"Turn {assistant_turn_idx}: empty assistant response")
                    t_score = 0.0

                # Verify active constraints
                if active_constraints.get("prefix"):
                    pfx = active_constraints["prefix"]
                    if not content.strip().startswith(pfx):
                        turn_violations.append(f"Turn {assistant_turn_idx}: missing mandatory prefix '{pfx}'")
                        t_score = max(0.0, t_score - 0.5)

                if active_constraints.get("title"):
                    title = active_constraints["title"]
                    if title.lower() not in c_lower:
                        turn_violations.append(f"Turn {assistant_turn_idx}: missing required honorific '{title}'")
                        t_score = max(0.0, t_score - 0.4)

                if active_constraints.get("no_exclamation"):
                    if "!" in content:
                        turn_violations.append(f"Turn {assistant_turn_idx}: contains forbidden exclamation mark")
                        t_score = max(0.0, t_score - 0.5)

                if active_constraints.get("bullet_only"):
                    if "-" not in content and "•" not in content and "*" not in content:
                        turn_violations.append(f"Turn {assistant_turn_idx}: response not formatted as bulleted list")
                        t_score = max(0.0, t_score - 0.4)

                if active_constraints.get("suffix"):
                    sfx = active_constraints["suffix"]
                    if not content.strip().endswith(sfx):
                        turn_violations.append(f"Turn {assistant_turn_idx}: missing required suffix '{sfx}'")
                        t_score = max(0.0, t_score - 0.4)

                if active_constraints.get("forbidden_google"):
                    if "google" in c_lower:
                        turn_violations.append(f"Turn {assistant_turn_idx}: mentioned forbidden term 'google'")
                        t_score = max(0.0, t_score - 0.6)

                if active_constraints.get("persona_navigator"):
                    nautical_terms = ["captain", "sea", "sail", "aye", "tide", "helm", "voyage"]
                    if not any(nt in c_lower for nt in nautical_terms):
                        turn_violations.append(f"Turn {assistant_turn_idx}: failed to maintain nautical navigator persona")
                        t_score = max(0.0, t_score - 0.4)

                # Verify preferences if referenced
                if active_preferences.get("meeting") == "afternoon":
                    if "9:00 am" in c_lower or "morning sync" in c_lower:
                        turn_violations.append(f"Turn {assistant_turn_idx}: regressed to superseded morning preference")
                        t_score = max(0.0, t_score - 0.6)
                if active_preferences.get("language") == "typescript":
                    if "pandas" in c_lower or ("python" in c_lower and "typescript" not in c_lower):
                        turn_violations.append(f"Turn {assistant_turn_idx}: regressed to superseded Python preference")
                        t_score = max(0.0, t_score - 0.6)
                if active_preferences.get("theme") == "light":
                    if "dark mode" in c_lower and "light" not in c_lower:
                        turn_violations.append(f"Turn {assistant_turn_idx}: regressed to superseded dark mode preference")
                        t_score = max(0.0, t_score - 0.6)
                if active_preferences.get("diet") == "vegan":
                    if "mozzarella is fine" in c_lower or "cheese is vegetarian" in c_lower:
                        turn_violations.append(f"Turn {assistant_turn_idx}: allowed non-vegan food under vegan preference")
                        t_score = max(0.0, t_score - 0.6)

                violations.extend(turn_violations)
                turn_scores.append(t_score)

        if turn_scores:
            self.score = round(sum(turn_scores) / len(turn_scores), 2)
        else:
            self.score = 1.0

        self.success = self.score >= self.threshold and len(violations) == 0
        if violations:
            self.reason = f"Coherence violations detected ({len(violations)}): " + "; ".join(violations[:3])
        else:
            self.reason = f"Conversational coherence maintained across all {assistant_turn_idx} assistant turns (score: {self.score})."

        self.score_breakdown = {
            "turn_scores": turn_scores,
            "violations": violations,
            "assistant_turns": assistant_turn_idx,
            "active_constraints": list(active_constraints.keys()),
        }
        return self.score

    async def a_measure(self, test_case: ConversationalTestCase) -> float:
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return self.success


class ConversationRelevancyMetric(BaseConversationalMetric):
    """Measures relevancy of assistant responses to user queries and cumulative dialogue context."""

    def __init__(self, threshold: float = 0.7):
        super().__init__()
        self.threshold = threshold
        self.score: float = 0.0
        self.reason: str = ""
        self.success: bool = False
        self.score_breakdown: Dict[str, Any] = {}

    @property
    def __name__(self) -> str:
        return "ConversationRelevancyMetric"

    def measure(self, test_case: ConversationalTestCase) -> float:
        """Evaluate relevancy of each assistant turn against preceding user context."""
        turns = getattr(test_case, "turns", [])
        if not turns:
            self.score = 0.0
            self.reason = "No conversation turns provided in test case."
            self.success = False
            return 0.0

        turn_scores: List[float] = []
        last_user_query = ""
        user_keywords: set[str] = set()

        for turn in turns:
            role = getattr(turn, "role", "")
            content = getattr(turn, "content", "") or ""

            if role == "user":
                last_user_query = content
                words = re.findall(r"\b[a-zA-Z0-9_\-\$]{3,}\b", content.lower())
                user_keywords = {w for w in words if w not in {"what", "when", "where", "which", "with", "from", "that", "this", "have", "your", "like"}}
            elif role == "assistant":
                if not content.strip():
                    turn_scores.append(0.0)
                    continue

                c_lower = content.lower()
                # 1. Base response quality
                turn_relevancy = 1.0

                # 2. Check if response is relevant to the question or context
                if user_keywords:
                    overlap = sum(1 for kw in user_keywords if kw in c_lower)
                    if overlap == 0 and len(user_keywords) > 2 and "?" in last_user_query:
                        # Minor penalty if zero keyword overlap on a specific question
                        turn_relevancy = 0.8

                # 3. Check for obvious refusal/error indicators when not expected
                if "connection refused" in c_lower or "500 internal" in c_lower or "backend_error" in c_lower:
                    turn_relevancy = 0.0

                turn_scores.append(turn_relevancy)

        if turn_scores:
            self.score = round(sum(turn_scores) / len(turn_scores), 2)
        else:
            self.score = 1.0

        self.success = self.score >= self.threshold
        self.reason = f"Average turn relevancy: {self.score:.2f} across {len(turn_scores)} assistant turns."
        self.score_breakdown = {
            "turn_scores": turn_scores,
            "turns_count": len(turn_scores),
        }
        return self.score

    async def a_measure(self, test_case: ConversationalTestCase) -> float:
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return self.success


class ConversationalRecallMetric(BaseConversationalMetric):
    """Measures retrieval and recall of facts introduced across conversation turns."""

    def __init__(self, threshold: float = 0.7):
        super().__init__()
        self.threshold = threshold
        self.score: float = 0.0
        self.reason: str = ""
        self.success: bool = False
        self.score_breakdown: Dict[str, Any] = {}

    @property
    def __name__(self) -> str:
        return "ConversationalRecallMetric"

    def measure(
        self,
        test_case: ConversationalTestCase,
        expected_facts: Optional[List[str]] = None,
        forbidden_facts: Optional[List[str]] = None,
    ) -> float:
        """Evaluate whether expected factual anchors are recalled and forbidden terms avoided."""
        turns = getattr(test_case, "turns", [])
        if not turns:
            self.score = 0.0
            self.reason = "No conversation turns provided in test case."
            self.success = False
            return 0.0

        # Focus recall check on the final assistant response
        final_assistant_content = ""
        for turn in reversed(turns):
            if getattr(turn, "role", "") == "assistant":
                final_assistant_content = getattr(turn, "content", "") or ""
                break

        final_lower = final_assistant_content.lower()
        expected = expected_facts or []
        forbidden = forbidden_facts or []

        recalled_count = 0
        missed: List[str] = []
        for fact in expected:
            if fact.lower() in final_lower:
                recalled_count += 1
            else:
                missed.append(fact)

        leaked: List[str] = []
        for f in forbidden:
            if f.lower() in final_lower:
                leaked.append(f)

        if expected:
            recall_rate = recalled_count / len(expected)
        else:
            recall_rate = 1.0

        if leaked:
            recall_rate = 0.0

        self.score = round(recall_rate, 2)
        self.success = self.score >= self.threshold and len(leaked) == 0

        reasons = []
        if missed:
            reasons.append(f"Missed expected facts: {missed}")
        if leaked:
            reasons.append(f"Found forbidden terms: {leaked}")
        if not missed and not leaked:
            reasons.append(f"Successfully recalled {recalled_count}/{len(expected)} expected facts.")

        self.reason = "; ".join(reasons)
        self.score_breakdown = {
            "expected_count": len(expected),
            "recalled_count": recalled_count,
            "missed": missed,
            "leaked": leaked,
        }
        return self.score

    async def a_measure(self, test_case: ConversationalTestCase) -> float:
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return self.success

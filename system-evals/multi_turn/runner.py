"""Runner for Vela Multi-Turn Conversation Eval Pipeline.

Evaluates multi-turn conversational capabilities:
- Turn-over-turn coherence & state retention
- Dynamic preference contradiction overrides
- Cross-thread boundary isolation (no secret leakage)
- Long context instruction & persona drift resilience
- DeepEval ConversationalTestCase integration with Coherence & Relevancy metrics
- Honest provenance: Fail-closed on live backend errors with clear disclosure
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

base_dir = Path(__file__).resolve().parent.parent
if str(base_dir) not in sys.path:
    sys.path.insert(0, str(base_dir))

from common import FamilyResult
from adapters.client import TurnResult, VelaClient
from multi_turn.datasets import load_multi_turn_cases
from multi_turn.providers.mock_conversation_provider import MockConversationEngine
from multi_turn.metrics.coherence import (
    CoherenceMetric,
    ConversationRelevancyMetric,
    ConversationalRecallMetric,
)

try:
    from deepeval.test_case import ConversationalTestCase, Turn
except ImportError:
    # Minimal fallback representation if deepeval is not installed
    class ConversationalTestCase:  # type: ignore[no-redef]
        def __init__(self, turns: Any, **kwargs: Any):
            self.turns = turns
            for k, v in kwargs.items():
                setattr(self, k, v)

    class Turn:  # type: ignore[no-redef]
        def __init__(self, role: str, content: str, latency_ms: float = 0.0, **kwargs: Any):
            self.role = role
            self.content = content
            self.latency_ms = latency_ms
            for k, v in kwargs.items():
                setattr(self, k, v)


def run_multi_turn_eval(mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Execute multi-turn conversation evaluation suites.
    
    Hardening Rules:
    - Isolated Thread Namespaces: All turns use 'eval-thread-{id}' to isolate conversations.
    - No Memory Poisoning: Threads with 'eval-' prefix bypass persistent DB inserts.
    - Fail-Closed Execution: If live is requested and the backend is unreachable or errors,
      never mask with mock responses; report honest failure and provenance.
    - DeepEval Metrics: Evaluates CoherenceMetric and ConversationRelevancyMetric.
    - Per-Turn Assertions: Verifies constraints and responses at each turn transition.
    """
    cases = load_multi_turn_cases(mode=mode)
    if not cases:
        return FamilyResult(
            family="multi-turn",
            status="error",
            total_cases=0,
            passed_cases=0,
            failed_cases=0,
            summary_metrics={"error": "no multi-turn cases loaded"},
            details=[],
        )

    client: Optional[VelaClient] = VelaClient() if live else None
    mock_engine = MockConversationEngine()

    passed = 0
    failed = 0
    details: List[Dict[str, Any]] = []
    total_turns_count = 0
    total_latency_ms = 0.0
    live_cases_count = 0
    mock_cases_count = 0
    coherence_scores: List[float] = []
    relevancy_scores: List[float] = []

    coherence_evaluator = CoherenceMetric()
    relevancy_evaluator = ConversationRelevancyMetric()
    recall_evaluator = ConversationalRecallMetric()

    for case in cases:
        case_id = case["id"]
        category = case.get("category", case.get("dataset", "general"))
        default_thread_id = f"eval-thread-{case_id}"
        mock_engine.reset()

        provider = "live" if live else "mock"
        if live:
            live_cases_count += 1
        else:
            mock_cases_count += 1

        case_violations: List[str] = []
        turn_objects: List[Turn] = []
        turn_latencies: List[float] = []
        last_turn_text = ""
        backend_error: Optional[str] = None

        # Execute conversation turns with incremental history playback
        for idx, turn_data in enumerate(case["turns"]):
            user_msg = turn_data["user"]
            raw_thread_id = turn_data.get("thread_id") or default_thread_id
            # Enforce isolated eval-thread- namespace
            thread_id = (
                raw_thread_id
                if raw_thread_id.startswith("eval-thread-")
                else f"eval-thread-{raw_thread_id}"
            )

            turn_objects.append(Turn(role="user", content=user_msg))

            turn_res: Optional[TurnResult] = None
            t_start = time.monotonic()

            if live:
                # Live backend execution: fail-closed if unreachable
                try:
                    assert client is not None
                    turn_res = client.send_turn(
                        message=user_msg,
                        thread_id=thread_id,
                    )
                    if not turn_res.is_success or not turn_res.text:
                        backend_error = (
                            f"backend_error:{turn_res.error_message or 'empty_response'}"
                        )
                except Exception as e:
                    backend_error = f"backend_unreachable:{type(e).__name__}: {str(e)}"
                    turn_res = None
            else:
                # Offline mock execution with stateful conversation engine
                turn_res = mock_engine.send_turn(
                    message=user_msg,
                    thread_id=thread_id,
                    case=case,
                )

            elapsed_ms = (
                turn_res.latency_ms
                if turn_res and turn_res.latency_ms > 0
                else (time.monotonic() - t_start) * 1000
            )
            turn_latencies.append(round(elapsed_ms, 2))
            total_latency_ms += elapsed_ms
            total_turns_count += 1

            if backend_error or turn_res is None or not turn_res.is_success:
                case_violations.append(backend_error or "turn_execution_failed")
                break

            assistant_text = turn_res.text
            last_turn_text = assistant_text
            turn_objects.append(
                Turn(role="assistant", content=assistant_text, latency_ms=elapsed_ms)
            )

            # Per-turn assertion for intermediate constraints
            if not assistant_text.strip():
                case_violations.append(f"Turn {idx + 1}: empty assistant response")

            turn_expected = turn_data.get("expected_keywords")
            if turn_expected:
                missing = [kw for kw in turn_expected if kw.lower() not in assistant_text.lower()]
                if missing:
                    case_violations.append(f"Turn {idx + 1} missing expected: {missing}")

            turn_forbidden = turn_data.get("forbidden_keywords")
            if turn_forbidden:
                found = [kw for kw in turn_forbidden if kw.lower() in assistant_text.lower()]
                if found:
                    case_violations.append(f"Turn {idx + 1} found forbidden: {found}")

        # Final turn assertions
        expected_kws = case.get("expected_keywords", [])
        forbidden_kws = case.get("forbidden_keywords", [])

        if category == "thread_isolation":
            # For thread isolation refusals, matching any of the refusal variations satisfies the condition
            has_expected = (
                any(kw.lower() in last_turn_text.lower() for kw in expected_kws)
                if expected_kws
                else True
            )
        else:
            # For factual recall and contradiction overrides, all expected keywords must be satisfied
            has_expected = (
                all(kw.lower() in last_turn_text.lower() for kw in expected_kws)
                if expected_kws
                else True
            )

        if not has_expected and expected_kws and not backend_error:
            case_violations.append(f"Final turn missing expected keywords: {expected_kws}")

        has_forbidden = (
            any(kw.lower() in last_turn_text.lower() for kw in forbidden_kws)
            if forbidden_kws
            else False
        )
        if has_forbidden:
            found_forbidden = [kw for kw in forbidden_kws if kw.lower() in last_turn_text.lower()]
            case_violations.append(f"Final turn contains forbidden keywords: {found_forbidden}")

        # DeepEval Metric Evaluation
        test_case = ConversationalTestCase(
            turns=turn_objects,
            scenario=case_id,
            name=case.get("description", case_id),
        )

        c_score = coherence_evaluator.measure(test_case)
        r_score = relevancy_evaluator.measure(test_case)
        coherence_scores.append(c_score)
        relevancy_scores.append(r_score)

        if not coherence_evaluator.is_successful():
            case_violations.append(f"Coherence failure: {coherence_evaluator.reason}")

        case_passed = (backend_error is None) and (len(case_violations) == 0) and has_expected and not has_forbidden

        if case_passed:
            passed += 1
        else:
            failed += 1

        details.append({
            "id": case_id,
            "category": category,
            "description": case.get("description", ""),
            "provider": provider,
            "passed": case_passed,
            "coherence_score": c_score,
            "relevancy_score": r_score,
            "turns_count": len(turn_objects) // 2,
            "turn_latencies_ms": turn_latencies,
            "violations": case_violations,
            "final_response": last_turn_text[:300],
        })

    total_cases = len(cases)
    avg_coherence = (
        round(sum(coherence_scores) / len(coherence_scores), 2) if coherence_scores else 0.0
    )
    avg_relevancy = (
        round(sum(relevancy_scores) / len(relevancy_scores), 2) if relevancy_scores else 0.0
    )
    avg_latency = (
        round(total_latency_ms / total_turns_count, 2) if total_turns_count > 0 else 0.0
    )

    status = "passed" if failed == 0 and total_cases > 0 else "failed"

    return FamilyResult(
        family="multi-turn",
        status=status,
        total_cases=total_cases,
        passed_cases=passed,
        failed_cases=failed,
        summary_metrics={
            "coherence_rate": round(passed / total_cases, 2) if total_cases > 0 else 0.0,
            "avg_coherence_score": avg_coherence,
            "avg_relevancy_score": avg_relevancy,
            "avg_latency_ms": avg_latency,
            "total_turns": total_turns_count,
            "live_cases": live_cases_count,
            "mock_cases": mock_cases_count,
        },
        details=details,
    )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Multi-Turn Conversation Eval Runner")
    parser.add_argument("--mode", choices=["smoke", "nightly"], default="smoke")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    res = run_multi_turn_eval(mode=args.mode, live=args.live)
    print(f"Status: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")
    print(json.dumps(res.summary_metrics, indent=2))
    sys.exit(0 if res.status == "passed" else 1)

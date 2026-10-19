"""Loop detection algorithms for Browser Automation trajectories.

Adversarial Hardening Rules:
- Detects identical consecutive error / no-op loops (k >= 3).
- Detects alternating cyclic traps (A-B-A-B period-2 and period-L patterns).
- Detects slow pagination drift / oscillation across URLs and query offsets.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse


@dataclass
class LoopDetectionResult:
    """Structured result of loop detection analysis."""

    has_loop: bool
    loop_type: str | None = None  # "identical_repeat", "alternating_cycle", "pagination_drift"
    cycle_length: int = 0
    pattern_description: str = ""
    detected_at_step: int | None = None

    def __bool__(self) -> bool:
        return self.has_loop

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, bool):
            return self.has_loop == other
        if isinstance(other, LoopDetectionResult):
            return (
                self.has_loop == other.has_loop
                and self.loop_type == other.loop_type
                and self.cycle_length == other.cycle_length
            )
        return False


def _step_signature(step: dict[str, Any]) -> tuple[str, str, str]:
    action = str(step.get("action", "")).strip().lower()
    target = str(step.get("target", "")).strip()
    status = str(step.get("status", "")).strip().lower()
    return (action, target, status)


def _check_identical_repeats(steps: list[dict[str, Any]], min_repeats: int = 3) -> LoopDetectionResult | None:
    """Detect k >= 3 identical consecutive actions."""
    if len(steps) < min_repeats:
        return None

    signatures = [_step_signature(s) for s in steps]
    for i in range(len(signatures) - min_repeats + 1):
        window = signatures[i : i + min_repeats]
        if all(sig == window[0] for sig in window):
            action, target, status = window[0]
            # Flag if status is error or repeating identical click/type action
            return LoopDetectionResult(
                has_loop=True,
                loop_type="identical_repeat",
                cycle_length=1,
                pattern_description=f"Identical action '{action}' on '{target}' repeated {min_repeats} consecutive times with status='{status}'",
                detected_at_step=steps[i + min_repeats - 1].get("step_number", i + min_repeats),
            )
    return None


def _check_alternating_cycles(steps: list[dict[str, Any]], max_period: int = 4) -> LoopDetectionResult | None:
    """Detect alternating cycles like A-B-A-B (period 2) or A-B-C-A-B-C (period 3)."""
    if len(steps) < 4:
        return None

    signatures = [(_step_signature(s)[0], _step_signature(s)[1]) for s in steps]

    for period in range(2, max_period + 1):
        required_len = period * 2
        if len(signatures) < required_len:
            continue

        for i in range(len(signatures) - required_len + 1):
            pattern_a = signatures[i : i + period]
            pattern_b = signatures[i + period : i + 2 * period]

            # Check that elements within pattern_a are not all identical (that would be identical_repeat)
            if len(set(pattern_a)) > 1 and pattern_a == pattern_b:
                desc = " -> ".join(f"{act}:{tgt}" for act, tgt in pattern_a)
                return LoopDetectionResult(
                    has_loop=True,
                    loop_type="alternating_cycle",
                    cycle_length=period,
                    pattern_description=f"Alternating cycle of length {period} detected: [{desc}] repeated",
                    detected_at_step=steps[i + 2 * period - 1].get("step_number", i + 2 * period),
                )
    return None


def _check_pagination_drift(steps: list[dict[str, Any]]) -> LoopDetectionResult | None:
    """Detect slow pagination drift or cyclic URL / query offset oscillation."""
    if len(steps) < 3:
        return None

    url_records: list[tuple[str, int]] = []
    for s in steps:
        url = s.get("page_url") or ""
        if s.get("action") == "navigate" and s.get("target"):
            url = s.get("target")
        if url:
            step_num = s.get("step_number")
            if step_num is None:
                step_num = len(url_records) + 1
            url_records.append((url, step_num))

    if len(url_records) >= 4:
        # Check URL alternating cycle (e.g. u1, u2, u1, u2)
        for i in range(len(url_records) - 3):
            u0, s0 = url_records[i]
            u1, s1 = url_records[i + 1]
            u2, s2 = url_records[i + 2]
            u3, s3 = url_records[i + 3]
            if u0 == u2 and u1 == u3 and u0 != u1:
                return LoopDetectionResult(
                    has_loop=True,
                    loop_type="pagination_drift",
                    cycle_length=2,
                    pattern_description=f"Oscillating URL navigation cycle detected between '{u0}' and '{u1}'",
                    detected_at_step=s3,
                )

        # Check cyclic sequence of length 3 (e.g. u1 -> u2 -> u3 -> u1 -> u2)
        if len(url_records) >= 5:
            for i in range(len(url_records) - 4):
                u0, s0 = url_records[i]
                u1, s1 = url_records[i + 1]
                u2, s2 = url_records[i + 2]
                u3, s3 = url_records[i + 3]
                u4, s4 = url_records[i + 4]
                if u0 == u3 and u1 == u4 and u0 != u1:
                    return LoopDetectionResult(
                        has_loop=True,
                        loop_type="pagination_drift",
                        cycle_length=3,
                        pattern_description=f"Cyclic 3-step URL drift detected starting at '{u0}'",
                        detected_at_step=s4,
                    )

    # Check query offset oscillation (e.g. offset=20 -> offset=40 -> offset=20 -> offset=40)
    offset_records: list[tuple[int, int]] = []
    for u, step_num in url_records:
        parsed = urlparse(u)
        qs = parse_qs(parsed.query)
        val = qs.get("offset") or qs.get("page")
        if val and val[0].isdigit():
            offset_records.append((int(val[0]), step_num))

    if len(offset_records) >= 4:
        for i in range(len(offset_records) - 3):
            v0, s0 = offset_records[i]
            v1, s1 = offset_records[i + 1]
            v2, s2 = offset_records[i + 2]
            v3, s3 = offset_records[i + 3]
            if v0 == v2 and v1 == v3 and v0 != v1:
                return LoopDetectionResult(
                    has_loop=True,
                    loop_type="pagination_drift",
                    cycle_length=2,
                    pattern_description=f"Pagination parameter oscillation detected: {v0} <-> {v1}",
                    detected_at_step=s3,
                )

    return None


def detect_navigation_loops(steps: list[dict[str, Any]]) -> LoopDetectionResult:
    """Analyze a trajectory of steps and determine whether a navigation loop occurred."""
    if not steps or len(steps) < 2:
        return LoopDetectionResult(has_loop=False)

    # 1. Identical 3+ repeats check
    res = _check_identical_repeats(steps, min_repeats=3)
    if res is not None:
        return res

    # 2. Pagination drift check (URLs, query offsets, pagination loops)
    res = _check_pagination_drift(steps)
    if res is not None:
        return res

    # 3. Alternating cycles check (A-B-A-B element toggling)
    res = _check_alternating_cycles(steps, max_period=4)
    if res is not None:
        return res

    return LoopDetectionResult(has_loop=False)

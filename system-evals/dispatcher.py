"""Dispatcher and registry for system-evals families."""

from __future__ import annotations

import os
import time
from typing import Any, Callable

from common import FamilyResult
from config import config

ALL_FAMILIES = [
    "safety",
    "multi-turn",
    "tool-calling",
    "cost-latency",
    "browser-automation",
    "phone-automation",
    "workspace-automation",
    "memory",
]


class RunnerRegistry:
    """Registry of family execution handlers."""

    def __init__(self):
        self._handlers: dict[str, Callable[[str, bool], FamilyResult]] = {}

    def register(self, family: str, handler: Callable[[str, bool], FamilyResult]) -> None:
        self._handlers[family] = handler

    def execute(self, family: str, mode: str, live: bool) -> FamilyResult:
        if family not in self._handlers:
            return FamilyResult(
                family=family,
                status="error",
                error=f"Unknown family '{family}'. Available: {list(self._handlers.keys())}",
            )
        start = time.monotonic()
        try:
            res = self._handlers[family](mode, live)
            res.duration_s = round(time.monotonic() - start, 2)
            return res
        except Exception as e:
            return FamilyResult(
                family=family,
                status="error",
                duration_s=round(time.monotonic() - start, 2),
                error=str(e),
            )


registry = RunnerRegistry()


def _run_safety(mode: str, live: bool) -> FamilyResult:
    from safety.runner import run_safety_eval
    return run_safety_eval(mode=mode, live=live)

def _run_multi_turn(mode: str, live: bool) -> FamilyResult:
    from multi_turn.runner import run_multi_turn_eval
    return run_multi_turn_eval(mode=mode, live=live)

def _run_tool_calling(mode: str, live: bool) -> FamilyResult:
    from tool_calling.runner import run_tool_calling_eval
    return run_tool_calling_eval(mode=mode, live=live)

def _run_cost_latency(mode: str, live: bool) -> FamilyResult:
    from cost_latency.runner import run_cost_latency_eval
    return run_cost_latency_eval(mode=mode, live=live)

def _run_browser(mode: str, live: bool) -> FamilyResult:
    from browser_automation.runner import run_browser_eval
    return run_browser_eval(mode=mode, live=live)

def _run_phone(mode: str, live: bool) -> FamilyResult:
    from phone_automation.runner import run_phone_eval
    return run_phone_eval(mode=mode, live=live)

def _run_workspace(mode: str, live: bool) -> FamilyResult:
    from workspace_automation.runner import run_workspace_eval
    return run_workspace_eval(mode=mode, live=live)

def _run_memory(mode: str, live: bool) -> FamilyResult:
    from memory.runner import run_memory_eval
    return run_memory_eval(mode=mode, live=live)


registry.register("safety", _run_safety)
registry.register("multi-turn", _run_multi_turn)
registry.register("tool-calling", _run_tool_calling)
registry.register("cost-latency", _run_cost_latency)
registry.register("browser-automation", _run_browser)
registry.register("phone-automation", _run_phone)
registry.register("workspace-automation", _run_workspace)
registry.register("memory", _run_memory)


def run_family(family: str, mode: str = "smoke", live: bool = False) -> FamilyResult:
    """Programmatic entry point for running an evaluation family."""
    is_active = config.enabled or live or os.getenv("VELA_SYSTEM_EVALS_ENABLED") == "1"
    if not is_active:
        return FamilyResult(
            family=family,
            status="skipped",
            error="System evals disabled by default. Pass --live or set VELA_SYSTEM_EVALS_ENABLED=1.",
        )
    return registry.execute(family, mode=mode, live=live)


def run_all(mode: str = "smoke", live: bool = False) -> dict[str, FamilyResult]:
    """Programmatic entry point for running all evaluation families."""
    is_active = config.enabled or live or os.getenv("VELA_SYSTEM_EVALS_ENABLED") == "1"
    if not is_active:
        print("\n[INFO] Vela System Evals are currently DISABLED by default.")
        print("       Set VELA_SYSTEM_EVALS_ENABLED=1 or pass --live to execute.\n")
        return {
            fam: FamilyResult(
                family=fam,
                status="skipped",
                error="Disabled by default (VELA_SYSTEM_EVALS_ENABLED=0).",
            )
            for fam in ALL_FAMILIES
        }

    results = {}
    for fam in ALL_FAMILIES:
        print(f"\n▶ Running Family: {fam} (mode: {mode})...")
        results[fam] = registry.execute(fam, mode=mode, live=live)
        status_icon = "✅" if results[fam].status == "passed" else "❌" if results[fam].status == "failed" else "⚠️"
        print(f"  {status_icon} {fam}: {results[fam].status} ({results[fam].passed_cases}/{results[fam].total_cases} passed in {results[fam].duration_s}s)")

    return results

"""Common data structures and utilities for system-evals."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FamilyResult:
    """Standardized output across all 8 eval families."""
    family: str
    status: str  # "passed", "failed", "skipped", "error"
    total_cases: int = 0
    passed_cases: int = 0
    failed_cases: int = 0
    duration_s: float = 0.0
    summary_metrics: dict[str, Any] = field(default_factory=dict)
    details: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None

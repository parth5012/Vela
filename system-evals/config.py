"""Shared configuration for Vela System-Level Evaluation Pipelines.

Single source of truth for model specifications, API credentials,
cost/latency thresholds, and the master enable/disable gate.
"""

from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass, field


@dataclass(frozen=True)
class EvalThresholds:
    """Quality and performance bounds for gating."""
    min_judge_score: float = 4.0  # 1-5 scale
    min_pass_rate: float = 0.90   # 90% pass rate
    p95_latency_ms: int = 5000    # 5.0 seconds
    max_cost_per_turn_usd: float = 0.05
    max_step_count_browser: int = 15
    max_step_count_workspace: int = 8


@dataclass(frozen=True)
class SystemEvalConfig:
    """Master configuration for system evaluation suites."""

    # Master gate: disabled by default until production activation
    enabled: bool = field(
        default_factory=lambda: os.getenv("VELA_SYSTEM_EVALS_ENABLED", "0") == "1"
    )

    # Core models
    eval_model: str = field(
        default_factory=lambda: os.getenv("VELA_EVAL_MODEL", "gemini-2.5-flash")
    )
    judge_model: str = field(
        default_factory=lambda: os.getenv("VELA_JUDGE_MODEL", "meta-llama/llama-3.3-70b-instruct")
    )

    # Base URLs and credentials
    backend_url: str = field(
        default_factory=lambda: os.getenv("VELA_BACKEND_URL", "http://localhost:8000")
    )
    api_key: str = field(
        default_factory=lambda: os.getenv("VELA_API_KEY", "vela5012")
    )
    openrouter_api_key: str | None = field(
        default_factory=lambda: os.getenv("OPENROUTER_API_KEY")
    )
    google_api_key: str | None = field(
        default_factory=lambda: os.getenv("GOOGLE_AI_API_KEY")
    )

    # Directory layout
    root_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent
    )
    reports_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent / "reports"
    )

    # Thresholds
    thresholds: EvalThresholds = field(default_factory=EvalThresholds)


# Singleton instance
config = SystemEvalConfig()

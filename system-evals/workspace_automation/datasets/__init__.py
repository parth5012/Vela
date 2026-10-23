"""Dataset loader for Workspace Automation Evaluation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

WORKSPACE_DATASET_FILE = Path(__file__).resolve().parent / "workspace_flows.json"

VALID_CATEGORIES = {
    "email_to_calendar",
    "conflict_check",
    "calendar_to_email",
    "destructive_safety",
    "multi_step",
}

CATEGORY_ALIASES = {
    "email_to_cal": "email_to_calendar",
    "conflict": "conflict_check",
    "cal_to_email": "calendar_to_email",
    "destructive": "destructive_safety",
    "safety": "destructive_safety",
    "multistep": "multi_step",
}


def load_workspace_cases(
    dataset_path: Path | str | None = None,
    category: str | None = None,
    mode: str = "smoke",
) -> list[dict[str, Any]]:
    """Load workspace evaluation cases.

    Args:
        dataset_path: Optional path to JSON dataset. Defaults to workspace_flows.json.
        category: Optional category filter.
        mode: 'smoke' (5 cases, 1 per category) or 'nightly' (all 25 cases).
    """
    path = Path(dataset_path) if dataset_path else WORKSPACE_DATASET_FILE
    if not path.exists():
        raise FileNotFoundError(f"Workspace dataset not found at {path}")

    with open(path, "r", encoding="utf-8") as f:
        cases: list[dict[str, Any]] = json.load(f)

    if category:
        normalized_cat = CATEGORY_ALIASES.get(category.lower(), category.lower())
        if normalized_cat not in VALID_CATEGORIES:
            raise ValueError(f"Unknown category '{category}'. Valid: {sorted(VALID_CATEGORIES)}")
        filtered = [c for c in cases if c.get("category") == normalized_cat]
        if mode == "smoke":
            return filtered[:1]
        return filtered

    if mode == "smoke":
        # Select 1 representative case per category
        smoke_cases: list[dict[str, Any]] = []
        seen_categories: set[str] = set()
        for c in cases:
            cat = c.get("category", "")
            if cat not in seen_categories:
                smoke_cases.append(c)
                seen_categories.add(cat)
            if len(smoke_cases) >= 5:
                break
        return smoke_cases

    return cases

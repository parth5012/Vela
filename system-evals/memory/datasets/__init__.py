"""Dataset loader for Memory & Retrieval Evaluation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MEMORY_DATASET_FILE = Path(__file__).resolve().parent / "memory_cases.json"

VALID_CATEGORIES = {
    "preference_recall",
    "temporal_updates",
    "contradiction_resolution",
    "cross_domain_synthesis",
    "negative_retrieval",
}

CATEGORY_ALIASES = {
    "preferences": "preference_recall",
    "preference": "preference_recall",
    "temporal": "temporal_updates",
    "updates": "temporal_updates",
    "contradiction": "contradiction_resolution",
    "contradictions": "contradiction_resolution",
    "cross_domain": "cross_domain_synthesis",
    "synthesis": "cross_domain_synthesis",
    "negative": "negative_retrieval",
}


def load_memory_cases(
    dataset_path: Path | str | None = None,
    category: str | None = None,
    mode: str = "smoke",
) -> list[dict[str, Any]]:
    """Load memory evaluation cases.

    Args:
        dataset_path: Optional path to JSON dataset. Defaults to memory_cases.json.
        category: Optional category filter.
        mode: 'smoke' (5 cases, 1 per category) or 'nightly' (all 25 cases).
    """
    path = Path(dataset_path) if dataset_path else MEMORY_DATASET_FILE
    if not path.exists():
        raise FileNotFoundError(f"Memory cases dataset not found at {path}")

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

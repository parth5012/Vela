"""Dataset loader for multi-turn conversation evaluation suites."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATASETS_DIR = Path(__file__).resolve().parent

DATASET_FILES = {
    "recall": "recall_accuracy.json",
    "contradiction_overrides": "contradiction_overrides.json",
    "thread_isolation": "thread_isolation.json",
    "long_context_drift": "long_context_drift.json",
}

DATASET_ALIASES = {
    "contradiction_override": "contradiction_overrides",
    "isolation": "thread_isolation",
    "drift": "long_context_drift",
}


def load_multi_turn_cases(
    dataset: str | None = None,
    mode: str = "nightly",
) -> list[dict[str, Any]]:
    """Load multi-turn evaluation cases from JSON dataset files.

    Args:
        dataset: Specific category name or alias (e.g. 'recall', 'contradiction_overrides').
                 If None, loads all 4 categories.
        mode: Execution mode ('smoke' loads 1 case per category, 'nightly' loads all cases).

    Returns:
        List of structured multi-turn test case dictionaries.

    Raises:
        ValueError: If a non-None dataset name is provided that does not match any category or alias.
    """
    cases: list[dict[str, Any]] = []

    if dataset is not None:
        normalized_dataset = DATASET_ALIASES.get(dataset, dataset)
        if normalized_dataset not in DATASET_FILES:
            valid_keys = list(DATASET_FILES.keys()) + list(DATASET_ALIASES.keys())
            raise ValueError(
                f"Unknown dataset '{dataset}'. Expected one of: {valid_keys}"
            )
        target_files = {normalized_dataset: DATASET_FILES[normalized_dataset]}
    else:
        target_files = DATASET_FILES

    for cat, filename in target_files.items():
        file_path = DATASETS_DIR / filename
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                for c in loaded:
                    c.setdefault("dataset", cat)
                cases.extend(loaded)

    if mode == "smoke":
        # Select 1 representative case from each category (4 cases total)
        smoke_cases = []
        for cat in target_files.keys():
            matching = [c for c in cases if c.get("dataset") == cat or c.get("category") == cat]
            if matching:
                smoke_cases.append(matching[0])
        return smoke_cases

    return cases

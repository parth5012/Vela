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


def load_multi_turn_cases(
    dataset: str | None = None,
    mode: str = "nightly",
) -> list[dict[str, Any]]:
    """Load multi-turn evaluation cases from JSON dataset files.
    
    If dataset is specified, loads only cases from that category.
    If mode is 'smoke', selects a fast representative subset (1 from each category).
    """
    cases: list[dict[str, Any]] = []

    target_files = (
        {dataset: DATASET_FILES[dataset]}
        if dataset and dataset in DATASET_FILES
        else DATASET_FILES
    )

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
        for cat in DATASET_FILES.keys():
            matching = [c for c in cases if c.get("dataset") == cat or c.get("category") == cat]
            if matching:
                smoke_cases.append(matching[0])
        return smoke_cases

    return cases

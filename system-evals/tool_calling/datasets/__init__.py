"""Dataset loader for tool-calling evaluation suites."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATASETS_DIR = Path(__file__).resolve().parent

DATASET_FILES = {
    "tool_selection": "tool_selection.json",
    "tool_arguments": "tool_arguments.json",
    "tool_sequencing": "tool_sequencing.json",
    "tool_negative": "tool_negative.json",
}

DATASET_ALIASES = {
    "selection": "tool_selection",
    "arguments": "tool_arguments",
    "sequencing": "tool_sequencing",
    "negative": "tool_negative",
    "tool_selections": "tool_selection",
    "tool_argument": "tool_arguments",
    "tool_sequencing_cases": "tool_sequencing",
    "tool_negatives": "tool_negative",
    "negatives": "tool_negative",
}


def _normalize_names(dataset) -> list[str] | None:
    if dataset is None:
        return None
    if isinstance(dataset, (list, tuple, set)):
        names = list(dataset)
    elif isinstance(dataset, str):
        names = [dataset]
    else:
        names = [str(dataset)]
    normalized = []
    for name in names:
        key = DATASET_ALIASES.get(name, name)
        # allow filename-style inputs
        key = key.replace(".json", "")
        normalized.append(key)
    return normalized


def load_tool_calling_cases(
    dataset=None,
    mode: str = "nightly",
    datasets=None,
    dataset_names=None,
    category=None,
    categories=None,
    *args,
    **kwargs,
) -> list[dict[str, Any]]:
    # Accept positional dataset names (safety-style)
    if args:
        if dataset is None and isinstance(args[0], (str, list, tuple, set)):
            dataset = args[0]

    # Collect dataset names from various kwargs
    name_sources = [dataset, datasets, dataset_names, category, categories]
    # also arbitrary kwargs like dataset_name
    for k in ("dataset_name", "categories_list"):
        if k in kwargs:
            name_sources.append(kwargs.pop(k))

    chosen_names = None
    for src in name_sources:
        if src is not None:
            chosen_names = _normalize_names(src)
            break

    # mode may be passed positionally after dataset (safety-style not typical)
    if "mode" in kwargs:
        mode = kwargs.pop("mode")

    if chosen_names is not None:
        unknown = [n for n in chosen_names if n not in DATASET_FILES]
        if unknown:
            valid = list(DATASET_FILES.keys()) + list(DATASET_ALIASES.keys())
            raise ValueError(f"Unknown dataset '{unknown}'. Expected one of: {valid}")
        target = {k: DATASET_FILES[k] for k in chosen_names}
    else:
        target = DATASET_FILES

    cases: list[dict[str, Any]] = []
    for cat, filename in target.items():
        file_path = DATASETS_DIR / filename
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                for c in loaded:
                    c.setdefault("dataset", cat)
                    c.setdefault("category", cat)
                cases.extend(loaded)

    if mode == "smoke":
        smoke_cases = []
        for cat in target.keys():
            matching = [c for c in cases if c.get("dataset") == cat or c.get("category") == cat]
            if matching:
                smoke_cases.append(matching[0])
        return smoke_cases

    return cases

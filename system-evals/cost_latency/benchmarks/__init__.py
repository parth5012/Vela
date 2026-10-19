"""Dataset loader for cost & latency benchmarks."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATASETS_DIR = Path(__file__).resolve().parent

DATASET_FILES = {
    "micro_turns": "micro_turns.json",
    "medium_reasoning": "medium_reasoning.json",
    "heavy_code_research": "heavy_code_research.json",
}

DATASET_ALIASES = {
    "micro": "micro_turns",
    "medium": "medium_reasoning",
    "heavy": "heavy_code_research",
}


def _normalize(name):
    s = name.replace(".json", "")
    return DATASET_ALIASES.get(s, s)


def load_cost_latency_cases(dataset=None, mode="nightly", *args, **kwargs):
    if args and dataset is None:
        dataset = args[0]
    for k in ("datasets", "dataset_names", "category", "categories"):
        if k in kwargs and dataset is None:
            dataset = kwargs.pop(k)
    if "mode" in kwargs:
        mode = kwargs.pop("mode")

    if dataset is not None:
        if isinstance(dataset, (list, tuple, set)):
            names = [_normalize(x) for x in dataset]
        else:
            names = [_normalize(dataset)]
        unknown = [n for n in names if n not in DATASET_FILES]
        if unknown:
            raise ValueError(f"Unknown dataset '{unknown}'. Expected one of: {list(DATASET_FILES.keys()) + list(DATASET_ALIASES.keys())}")
        target = {k: DATASET_FILES[k] for k in names}
    else:
        target = DATASET_FILES

    cases = []
    for cat, filename in target.items():
        fp = DATASETS_DIR / filename
        if not fp.exists():
            raise FileNotFoundError(f"Dataset file '{filename}' not found")
        with open(fp) as f:
            loaded = json.load(f)
            for c in loaded:
                c.setdefault("dataset", cat)
                c.setdefault("category", cat)
            cases.extend(loaded)

    if mode == "smoke":
        smoke = []
        for cat in target:
            matching = [c for c in cases if c.get("dataset") == cat or c.get("category") == cat]
            if matching:
                smoke.append(matching[0])
        return smoke
    return cases

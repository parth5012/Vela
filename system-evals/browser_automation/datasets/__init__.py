"""Dataset loader for Browser Automation Trajectory Evaluation (Family 5)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATASETS_DIR = Path(__file__).resolve().parent

DATASET_FILES = {
    "success_flows": "success_flows.json",
    "loop_failures": "loop_failures.json",
    "adversarial_dom": "adversarial_dom.json",
}

DATASET_ALIASES = {
    "success": "success_flows",
    "successes": "success_flows",
    "flows": "success_flows",
    "loop": "loop_failures",
    "loops": "loop_failures",
    "failures": "loop_failures",
    "adversarial": "adversarial_dom",
    "adversarial_doms": "adversarial_dom",
    "dom": "adversarial_dom",
    "all": "all",
    "trajectories": "all",
}


def _normalize(name: str) -> str:
    s = name.replace(".json", "")
    return DATASET_ALIASES.get(s, s)


def load_browser_cases(dataset: Any = None, mode: str = "nightly", *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
    """Load browser automation trajectory cases.

    Supports category filtering ('success_flows', 'loop_failures', 'adversarial_dom')
    and evaluation modes ('smoke' picks 1 per category, 'nightly' loads all).
    """
    if dataset in ("smoke", "nightly") and "mode" not in kwargs:
        mode = dataset
        dataset = None

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

        if "all" in names:
            target = DATASET_FILES
        else:
            unknown = [n for n in names if n not in DATASET_FILES]
            if unknown:
                raise ValueError(
                    f"Unknown dataset '{unknown}'. Expected one of: "
                    f"{list(DATASET_FILES.keys()) + list(DATASET_ALIASES.keys())}"
                )
            target = {k: DATASET_FILES[k] for k in names}
    else:
        target = DATASET_FILES

    cases: list[dict[str, Any]] = []
    for cat, filename in target.items():
        fp = DATASETS_DIR / filename
        if not fp.exists():
            raise FileNotFoundError(f"Dataset file '{filename}' not found at {fp}")
        with open(fp, "r", encoding="utf-8") as f:
            loaded = json.load(f)
            for c in loaded:
                c.setdefault("dataset", cat)
                c.setdefault("category", cat)
            cases.extend(loaded)

    if mode == "smoke":
        smoke: list[dict[str, Any]] = []
        for cat in target:
            matching = [c for c in cases if c.get("dataset") == cat or c.get("category") == cat]
            if matching:
                smoke.append(matching[0])
        return smoke

    return cases

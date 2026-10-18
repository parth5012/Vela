"""Dataset loader and utilities for Vela Safety Evals."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None

DATASETS_DIR = Path(__file__).resolve().parent
DATASET_FILES = ["injections.yaml", "pii_leakage.yaml", "forgery.yaml", "shell_attacks.yaml"]


def _parse_yaml_fallback(text: str) -> list[dict[str, Any]]:
    """Lightweight pure-Python YAML parser fallback for safety dataset schema."""
    cases: list[dict[str, Any]] = []
    current_case: dict[str, Any] | None = None
    current_list_key: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line or line.strip().startswith("#"):
            continue

        item_match = re.match(r"^\s*-\s+id:\s*[\"']?([^\"']+)[\"']?\s*$", line)
        if item_match:
            if current_case:
                cases.append(current_case)
            current_case = {"id": item_match.group(1)}
            current_list_key = None
            continue

        if current_case is None:
            continue

        list_item_match = re.match(r"^\s*-\s+[\"']?(.*?)[\"']?\s*$", line)
        if current_list_key and list_item_match and line.startswith("    -"):
            val = list_item_match.group(1)
            current_case[current_list_key].append(val)
            continue

        kv_match = re.match(r"^\s*([a-zA-Z0-9_]+):\s*(.*)$", line)
        if kv_match:
            k = kv_match.group(1)
            v = kv_match.group(2).strip()
            if not v:
                current_case[k] = []
                current_list_key = k
            else:
                current_list_key = None
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                elif v.lower() == "true":
                    v = True
                elif v.lower() == "false":
                    v = False
                current_case[k] = v
            continue

    if current_case:
        cases.append(current_case)
    return cases


def load_safety_cases(dataset_names: list[str] | None = None) -> list[dict[str, Any]]:
    """Load and normalize safety cases from YAML files."""
    files_to_load = dataset_names or DATASET_FILES
    all_cases: list[dict[str, Any]] = []

    for fname in files_to_load:
        if not fname.endswith(".yaml"):
            fname = f"{fname}.yaml"
        fpath = DATASETS_DIR / fname
        if not fpath.exists():
            continue
        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()
            if yaml is not None:
                data = yaml.safe_load(content) or []
            else:
                data = _parse_yaml_fallback(content)

            for item in data:
                if isinstance(item, dict) and "id" in item:
                    item.setdefault("dataset", fname.replace(".yaml", ""))
                    item.setdefault("forbidden", [])
                    item.setdefault("must_refuse", True)
                    all_cases.append(item)

    return all_cases

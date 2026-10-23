"""Datasets package for Phone Automation Intent-to-Action Evaluation."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None

DATASET_DIR = Path(__file__).resolve().parent

DATASET_FILES = [
    "action_mapping.yaml",
    "parameter_integrity.yaml",
    "shizuku_permissions.yaml",
    "ocr_screen_reading.yaml",
]


def _parse_yaml_fallback(text: str) -> list[dict[str, Any]]:
    """Lightweight pure-Python YAML parser fallback for phone automation dataset schema."""
    cases: list[dict[str, Any]] = []
    current_case: dict[str, Any] | None = None
    current_dict_key: str | None = None
    current_list_key: str | None = None
    current_list_item: dict[str, Any] | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line or line.strip().startswith("#"):
            continue

        # Top level case item: "- id: 'phone_...'" or "- id: 'param_...'" or "- id: 'shizuku_...'" or "- id: 'ocr_...'"
        # Distinct from sub-list items because it has 0 indentation ("- id:")
        top_item_match = re.match(r"^- id:\s*[\"']?([^\"']+)[\"']?\s*$", line)
        if top_item_match:
            if current_case:
                cases.append(current_case)
            current_case = {"id": top_item_match.group(1)}
            current_dict_key = None
            current_list_key = None
            current_list_item = None
            continue

        if current_case is None:
            continue

        # Sub-list items: indented "- ..."
        # Example 1:
        #   expected_texts:
        #     - "Battery: 88%"
        # Example 2:
        #   mock_screen_nodes:
        #     - id: "status_bar_battery"
        #       text: "Battery: 88%"
        sub_list_match = re.match(r"^\s{4}-\s+(.*)$", line)
        if current_list_key and sub_list_match:
            raw_val = sub_list_match.group(1).strip()
            # Check if this item starts a dict (e.g. `id: "status_bar_battery"`)
            dict_item_match = re.match(r"^([a-zA-Z0-9_]+):\s*(.*)$", raw_val)
            if dict_item_match:
                sub_k = dict_item_match.group(1)
                sub_v = dict_item_match.group(2).strip()
                if (sub_v.startswith('"') and sub_v.endswith('"')) or (sub_v.startswith("'") and sub_v.endswith("'")):
                    sub_v = sub_v[1:-1]
                current_list_item = {sub_k: sub_v}
                current_case[current_list_key].append(current_list_item)
            else:
                # Plain string scalar in list
                val = raw_val
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                current_case[current_list_key].append(val)
                current_list_item = None
            continue

        # Continuation properties of a dict in a list (indent 6)
        if current_list_item is not None and line.startswith("      "):
            prop_match = re.match(r"^\s{6}([a-zA-Z0-9_]+):\s*(.*)$", line)
            if prop_match:
                pk = prop_match.group(1)
                pv = prop_match.group(2).strip()
                if (pv.startswith('"') and pv.endswith('"')) or (pv.startswith("'") and pv.endswith("'")):
                    pv = pv[1:-1]
                current_list_item[pk] = pv
                continue

        # Sub-dictionary key-value (e.g. under expected_params, indent 4)
        if current_dict_key and line.startswith("    "):
            kv_sub = re.match(r"^\s{4}([a-zA-Z0-9_]+):\s*(.*)$", line)
            if kv_sub:
                sk = kv_sub.group(1)
                sv = kv_sub.group(2).strip()
                if (sv.startswith('"') and sv.endswith('"')) or (sv.startswith("'") and sv.endswith("'")):
                    sv = sv[1:-1]
                elif sv.isdigit():
                    sv = int(sv)
                elif sv.lower() == "true":
                    sv = True
                elif sv.lower() == "false":
                    sv = False
                current_case[current_dict_key][sk] = sv
                continue

        # Top level key under current case (indent 2: `  key: value` or `  key:`)
        kv_match = re.match(r"^\s{2}([a-zA-Z0-9_]+):\s*(.*)$", line)
        if kv_match:
            k = kv_match.group(1)
            v = kv_match.group(2).strip()
            if not v or v == "{}":
                if k in ("mock_screen_nodes", "expected_texts"):
                    current_case[k] = []
                    current_list_key = k
                    current_dict_key = None
                    current_list_item = None
                else:
                    current_case[k] = {}
                    current_dict_key = k
                    current_list_key = None
                    current_list_item = None
            else:
                current_dict_key = None
                current_list_key = None
                current_list_item = None
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                elif v.isdigit():
                    v = int(v)
                elif v.lower() == "true":
                    v = True
                elif v.lower() == "false":
                    v = False
                current_case[k] = v
            continue

    if current_case:
        cases.append(current_case)
    return cases


def load_phone_cases(mode: str = "smoke") -> list[dict[str, Any]]:
    """Load phone automation test cases from yaml dataset files.
    
    In 'smoke' mode, returns a representative subset (2 from each category).
    In 'nightly' mode, returns all 80 evaluation cases.
    """
    all_cases: list[dict[str, Any]] = []

    for fname in DATASET_FILES:
        path = DATASET_DIR / fname
        if not path.exists():
            continue

        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        if yaml is not None:
            cases = yaml.safe_load(content) or []
        else:
            cases = _parse_yaml_fallback(content)

        category = fname.replace(".yaml", "")
        for c in cases:
            c["category"] = category

        if mode == "smoke":
            all_cases.extend(cases[:2])
        else:
            all_cases.extend(cases)

    # Fallback to phone_cases.json if yaml files are missing
    if not all_cases:
        json_path = DATASET_DIR / "phone_cases.json"
        if json_path.exists():
            with open(json_path, "r", encoding="utf-8") as f:
                cases = json.load(f)
                all_cases = cases[:2] if mode == "smoke" else cases

    return all_cases

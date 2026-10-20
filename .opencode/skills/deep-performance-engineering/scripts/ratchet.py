#!/usr/bin/env python3
"""
Deep Performance Engineering: Regression Ratchet CLI
Compares benchmark run results against a locked baseline, calculates deltas,
validates target SLA compliance across reference standards (T3 Chat, ChatGPT, WhatsApp),
generates markdown comparison tables, and blocks regressions in CI/CD.
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

# Ensure stdout and stderr handle UTF-8 cleanly on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def load_metrics(filepath: str) -> Dict[str, Any]:
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Metric file not found: {filepath}")
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Normalize: supports either {"metrics": {...}} or direct {...}
    if "metrics" in data and isinstance(data["metrics"], dict):
        return data["metrics"]
    return data


def extract_metric_details(entry: Any) -> Dict[str, Any]:
    """Returns normalized metric details dictionary."""
    if isinstance(entry, (int, float)):
        return {
            "value": float(entry),
            "unit": "ms",
            "lower_is_better": True,
            "target": None,
            "tier": 1,
            "lane": 1,
            "description": ""
        }
    if isinstance(entry, dict):
        return {
            "value": float(entry.get("value", 0.0)),
            "unit": str(entry.get("unit", "ms")),
            "lower_is_better": bool(entry.get("lower_is_better", True)),
            "target": float(entry["target"]) if "target" in entry and entry["target"] is not None else None,
            "tier": int(entry.get("tier", 1)),
            "lane": int(entry.get("lane", 1)) if "lane" in entry else None,
            "description": str(entry.get("description", ""))
        }
    raise ValueError(f"Unrecognized metric entry format: {entry}")


def format_val_str(val: float, unit: str) -> str:
    if val == int(val):
        return f"{int(val)} {unit}"
    return f"{val:.2f} {unit}"


def compare_metrics(
    baseline: Dict[str, Any],
    current: Dict[str, Any],
    max_regression_pct: float = 5.0,
    abs_floor_ms: float = 1.0,
    target_lane: Optional[int] = None
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Compares baseline and current metrics.
    Applies noise floor smoothing: max(baseline * (1 + rel%), baseline + abs_floor)
    validates target SLA thresholds, and prevents false failures across split execution lanes.
    Returns (results_list, has_failed_gate).
    """
    results = []
    has_failed_gate = False

    current_details = {k: extract_metric_details(v) for k, v in current.items()}
    baseline_details = {k: extract_metric_details(v) for k, v in baseline.items()}

    # Detect active execution lanes in current run
    active_lanes = set()
    if target_lane is not None:
        active_lanes.add(target_lane)
    else:
        for k, d in current_details.items():
            if d.get("lane") is not None:
                active_lanes.add(d["lane"])
            elif k in baseline_details and baseline_details[k].get("lane") is not None:
                active_lanes.add(baseline_details[k]["lane"])

    all_keys = sorted(list(set(baseline.keys()).union(set(current.keys()))))

    for key in all_keys:
        if key not in baseline:
            c = current_details[key]
            results.append({
                "metric": key,
                "baseline": "N/A",
                "target": format_val_str(c["target"], c["unit"]) if c["target"] is not None else "N/A",
                "current": format_val_str(c["value"], c["unit"]),
                "delta": "NEW",
                "verdict": "ℹ️ NEW",
                "failed": False
            })
            continue

        b = baseline_details[key]

        if key not in current:
            # If baseline metric belongs to another execution lane (e.g. Lane 2 device gate during Lane 1 CI),
            # mark as skipped rather than failing the gate with a false positive.
            if b.get("lane") is not None and active_lanes and b["lane"] not in active_lanes:
                results.append({
                    "metric": key,
                    "baseline": format_val_str(b["value"], b["unit"]),
                    "target": format_val_str(b["target"], b["unit"]) if b["target"] is not None else "N/A",
                    "current": "N/A",
                    "delta": "N/A",
                    "verdict": f"⏭️ SKIPPED (Lane {b['lane']})",
                    "failed": False
                })
                continue

            results.append({
                "metric": key,
                "baseline": format_val_str(b["value"], b["unit"]),
                "target": format_val_str(b["target"], b["unit"]) if b["target"] is not None else "N/A",
                "current": "MISSING",
                "delta": "N/A",
                "verdict": "⚠️ MISSING",
                "failed": True
            })
            has_failed_gate = True
            continue

        c = current_details[key]
        base_val = b["value"]
        base_unit = b["unit"]
        lower_is_better = b["lower_is_better"]
        target = b["target"] if b["target"] is not None else c["target"]
        curr_val = c["value"]
        curr_unit = c["unit"]

        if base_val == 0:
            delta_pct = 0.0
        else:
            delta_pct = ((curr_val - base_val) / base_val) * 100.0

        # Determine absolute noise floor by metric unit
        if base_unit == "ms":
            metric_abs_floor = abs_floor_ms
        elif base_unit == "ratio":
            metric_abs_floor = 0.5
        elif base_unit in ("commits", "writes"):
            metric_abs_floor = 1.0
        elif base_unit == "pct":
            metric_abs_floor = 0.5
        elif base_unit == "mb":
            metric_abs_floor = 2.0
        else:
            metric_abs_floor = 0.0

        is_improvement = False
        is_regression = False
        is_warning = False

        # Target SLA compliance check
        target_breached = False
        if target is not None:
            if lower_is_better and curr_val > target:
                target_breached = True
            elif not lower_is_better and curr_val < target:
                target_breached = True

        if target_breached:
            is_regression = True
        elif lower_is_better:
            allowed_max = max(base_val * (1.0 + max_regression_pct / 100.0), base_val + metric_abs_floor)
            if target is not None and curr_val <= target:
                if curr_val > allowed_max:
                    is_warning = True
                elif delta_pct > max_regression_pct or (curr_val > base_val and 0.5 < delta_pct):
                    is_warning = True
                elif delta_pct < -1.0:
                    is_improvement = True
            else:
                if curr_val > allowed_max:
                    is_regression = True
                elif delta_pct > max_regression_pct or (curr_val > base_val and 0.5 < delta_pct):
                    is_warning = True
                elif delta_pct < -1.0:
                    is_improvement = True
        else:
            allowed_min = min(base_val * (1.0 - max_regression_pct / 100.0), base_val - metric_abs_floor)
            if target is not None and curr_val >= target:
                if curr_val < allowed_min:
                    is_warning = True
                elif delta_pct < -max_regression_pct or (curr_val < base_val and -max_regression_pct <= delta_pct < -0.5):
                    is_warning = True
                elif delta_pct > 1.0:
                    is_improvement = True
            else:
                if curr_val < allowed_min:
                    is_regression = True
                elif delta_pct < -max_regression_pct or (curr_val < base_val and -max_regression_pct <= delta_pct < -0.5):
                    is_warning = True
                elif delta_pct > 1.0:
                    is_improvement = True

        delta_sign = "+" if delta_pct > 0 else ""
        delta_str = f"{delta_sign}{delta_pct:.1f}%"

        if is_regression:
            verdict = "❌ FAILED"
            failed = True
            has_failed_gate = True
        elif is_improvement:
            verdict = "🚀 FASTER"
            failed = False
        elif is_warning:
            verdict = "⚠️ WARN"
            failed = False
        else:
            verdict = "✅ STABLE"
            failed = False

        results.append({
            "metric": key,
            "baseline": format_val_str(base_val, base_unit),
            "target": format_val_str(target, base_unit) if target is not None else "N/A",
            "current": format_val_str(curr_val, curr_unit),
            "delta": delta_str,
            "verdict": verdict,
            "failed": failed
        })

    return results, has_failed_gate


def format_markdown_table(results: List[Dict[str, Any]], max_regression_pct: float) -> str:
    lines = [
        "### ⏱️ Performance Ratchet Benchmark Report",
        f"**Allowed Regression Tolerance:** `{max_regression_pct}%`\n",
        "| Metric | Baseline | Target | Current | Delta | Verdict |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |"
    ]
    for r in results:
        lines.append(f"| `{r['metric']}` | {r['baseline']} | {r['target']} | {r['current']} | **{r['delta']}** | {r['verdict']} |")

    active_results = [r for r in results if not str(r["verdict"]).startswith("⏭️")]
    total_metrics = len(active_results)
    failed_count = sum(1 for r in active_results if r["failed"])
    improved_count = sum(1 for r in active_results if "FASTER" in r["verdict"])

    lines.append("")
    if failed_count > 0:
        lines.append(f"> ❌ **Regression Gate Failed**: {failed_count}/{total_metrics} active metrics regressed beyond tolerance or breached target SLA.")
    elif improved_count > 0:
        lines.append(f"> 🚀 **Regression Gate Passed**: {improved_count}/{total_metrics} active metrics improved and all meet target SLAs!")
    else:
        lines.append(f"> ✅ **Regression Gate Passed**: All {total_metrics} active metrics within acceptable threshold and meet target SLAs.")

    lines.append("> 🎯 **Reference Standards**: Calibrated against T3 Chat, ChatGPT, and WhatsApp performance targets.")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Performance Ratchet Comparator CLI")
    parser.add_argument("--baseline", required=True, help="Path to locked baseline JSON")
    parser.add_argument("--current", required=True, help="Path to current benchmark JSON")
    parser.add_argument("--lane", type=int, default=None, help="Explicit lane filter (e.g. 1 for headless CI, 2 for device)")
    parser.add_argument("--max-regression", type=float, default=5.0, help="Max allowed regression percentage (default: 5.0%%)")
    parser.add_argument("--abs-floor-ms", type=float, default=1.0, help="Absolute noise floor in ms for duration metrics (default: 1.0 ms)")
    parser.add_argument("--markdown-output", help="Optional path to write markdown summary")
    parser.add_argument("--update-baseline", action="store_true", help="Overwrite baseline with current metrics")
    parser.add_argument("--fail-on-regression", action="store_true", default=True, help="Exit with non-zero code on regression")

    args = parser.parse_args()

    try:
        baseline_data = load_metrics(args.baseline)
        current_data = load_metrics(args.current)
    except Exception as e:
        print(f"Error loading metric files: {e}", file=sys.stderr)
        sys.exit(2)

    results, has_failed_gate = compare_metrics(
        baseline=baseline_data,
        current=current_data,
        max_regression_pct=args.max_regression,
        abs_floor_ms=args.abs_floor_ms,
        target_lane=args.lane
    )

    markdown_report = format_markdown_table(results, args.max_regression)
    print("\n" + markdown_report + "\n")

    if args.markdown_output:
        os.makedirs(os.path.dirname(os.path.abspath(args.markdown_output)), exist_ok=True)
        with open(args.markdown_output, "w", encoding="utf-8") as f:
            f.write(markdown_report + "\n")
        print(f"Saved markdown report to: {args.markdown_output}")

    if args.update_baseline:
        with open(args.baseline, "w", encoding="utf-8") as f:
            json.dump(current_data, f, indent=2)
        print(f"✅ Baseline updated with current values in {args.baseline}")

    if has_failed_gate and args.fail_on_regression:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()

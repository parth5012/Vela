#!/usr/bin/env python3
"""
Deep Performance Engineering: Regression Ratchet CLI
Compares benchmark run results against a locked baseline, calculates deltas,
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


def extract_metric_details(entry: Any) -> Tuple[float, str, bool]:
    """Returns (value, unit, lower_is_better)."""
    if isinstance(entry, (int, float)):
        return float(entry), "ms", True
    if isinstance(entry, dict):
        val = float(entry.get("value", 0.0))
        unit = str(entry.get("unit", "ms"))
        lower_is_better = bool(entry.get("lower_is_better", True))
        return val, unit, lower_is_better
    raise ValueError(f"Unrecognized metric entry format: {entry}")


def compare_metrics(
    baseline: Dict[str, Any],
    current: Dict[str, Any],
    max_regression_pct: float = 5.0
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Compares baseline and current metrics.
    Returns (results_list, has_failed_gate).
    """
    results = []
    has_failed_gate = False

    all_keys = sorted(list(set(baseline.keys()).union(set(current.keys()))))

    for key in all_keys:
        if key not in baseline:
            val, unit, _ = extract_metric_details(current[key])
            results.append({
                "metric": key,
                "baseline": "N/A",
                "current": f"{val:.2f} {unit}",
                "delta": "NEW",
                "verdict": "ℹ️ NEW",
                "failed": False
            })
            continue

        if key not in current:
            val, unit, _ = extract_metric_details(baseline[key])
            results.append({
                "metric": key,
                "baseline": f"{val:.2f} {unit}",
                "current": "MISSING",
                "delta": "N/A",
                "verdict": "⚠️ MISSING",
                "failed": True
            })
            has_failed_gate = True
            continue

        base_val, base_unit, lower_is_better = extract_metric_details(baseline[key])
        curr_val, curr_unit, _ = extract_metric_details(current[key])

        if base_val == 0:
            if curr_val == 0:
                delta_pct = 0.0
            else:
                delta_pct = 100.0 if curr_val > 0 else -100.0
        else:
            delta_pct = ((curr_val - base_val) / base_val) * 100.0

        if lower_is_better:
            # For latency/overhead: negative delta is improvement (faster)
            is_improvement = delta_pct < -1.0
            is_regression = delta_pct > max_regression_pct
            is_warning = 0.5 < delta_pct <= max_regression_pct
        else:
            # For throughput/FPS: positive delta is improvement (higher is better)
            is_improvement = delta_pct > 1.0
            is_regression = delta_pct < -max_regression_pct
            is_warning = -max_regression_pct <= delta_pct < -0.5

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
            "baseline": f"{base_val:.2f} {base_unit}",
            "current": f"{curr_val:.2f} {curr_unit}",
            "delta": delta_str,
            "verdict": verdict,
            "failed": failed
        })

    return results, has_failed_gate


def format_markdown_table(results: List[Dict[str, Any]], max_regression_pct: float) -> str:
    lines = [
        "### ⏱️ Performance Ratchet Benchmark Report",
        f"**Allowed Regression Tolerance:** `{max_regression_pct}%`\n",
        "| Metric | Baseline | Current | Delta | Verdict |",
        "| :--- | :--- | :--- | :--- | :--- |"
    ]
    for r in results:
        lines.append(f"| `{r['metric']}` | {r['baseline']} | {r['current']} | **{r['delta']}** | {r['verdict']} |")
    
    total_metrics = len(results)
    failed_count = sum(1 for r in results if r["failed"])
    improved_count = sum(1 for r in results if "FASTER" in r["verdict"])

    lines.append("")
    if failed_count > 0:
        lines.append(f"> ❌ **Regression Gate Failed**: {failed_count}/{total_metrics} metrics regressed beyond {max_regression_pct}%.")
    elif improved_count > 0:
        lines.append(f"> 🚀 **Regression Gate Passed**: {improved_count}/{total_metrics} metrics improved. Consider updating baseline!")
    else:
        lines.append(f"> ✅ **Regression Gate Passed**: All metrics within acceptable threshold.")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Performance Ratchet Comparator CLI")
    parser.add_argument("--baseline", required=True, help="Path to locked baseline JSON")
    parser.add_argument("--current", required=True, help="Path to current benchmark JSON")
    parser.add_argument("--max-regression", type=float, default=5.0, help="Max allowed regression percentage (default: 5.0%%)")
    parser.add_argument("--markdown-output", help="Optional path to write markdown summary")
    parser.add_argument("--update-baseline", action="store_true", help="Overwrite baseline with current metrics")
    parser.add_argument("--fail-on-regression", action=argparse.BooleanOptionalAction, default=True, help="Exit with non-zero code on regression")

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
        max_regression_pct=args.max_regression
    )

    markdown_report = format_markdown_table(results, args.max_regression)
    print("\n" + markdown_report + "\n")

    if args.markdown_output:
        os.makedirs(os.path.dirname(os.path.abspath(args.markdown_output)), exist_ok=True)
        with open(args.markdown_output, "w", encoding="utf-8") as f:
            f.write(markdown_report + "\n")
        print(f"Saved markdown report to: {args.markdown_output}")

    if args.update_baseline:
        raw_baseline = {}
        if os.path.exists(args.baseline):
            with open(args.baseline, "r", encoding="utf-8") as f:
                raw_baseline = json.load(f)
        if "metrics" in raw_baseline and isinstance(raw_baseline["metrics"], dict):
            raw_baseline["metrics"].update(current_data)
        else:
            raw_baseline = {"metrics": current_data}
        with open(args.baseline, "w", encoding="utf-8") as f:
            json.dump(raw_baseline, f, indent=2)
            f.write("\n")
        print(f"✅ Baseline updated with current values in {args.baseline}")

    if has_failed_gate and args.fail_on_regression:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()

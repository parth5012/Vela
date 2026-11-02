#!/usr/bin/env python3
"""
Emit or update perf-baseline.json from benchmark harness outputs.
Adopts the schema from #461 / deep-performance-engineering.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASELINE = REPO_ROOT / "perf-baseline.json"
DEFAULT_CURRENT = REPO_ROOT / "results" / "perf-current.json"


def main():
    current_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CURRENT
    baseline_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_BASELINE

    if not current_path.exists():
        print(f"Error: Current metric file {current_path} does not exist", file=sys.stderr)
        sys.exit(1)

    with open(current_path, "r", encoding="utf-8") as f:
        current_data = json.load(f)

    metrics = current_data.get("metrics", current_data)

    cuj_keys = ["cold_start_to_typeable_ms", "send_to_bubble_ms", "stream_100_token_settle_ms"]
    cuj_metrics = {k: v for k, v in metrics.items() if k in cuj_keys}

    print(f"Extracted {len(cuj_metrics)} CUJ metric(s) from {current_path}:")
    for k, v in cuj_metrics.items():
        val = v.get("value") if isinstance(v, dict) else v
        unit = v.get("unit", "ms") if isinstance(v, dict) else "ms"
        print(f"  - {k}: {val} {unit}")

    baseline_data = {}
    if baseline_path.exists():
        with open(baseline_path, "r", encoding="utf-8") as f:
            baseline_data = json.load(f)

    if "metrics" in baseline_data and isinstance(baseline_data["metrics"], dict):
        baseline_data["metrics"].update(cuj_metrics)
    else:
        baseline_data = current_data

    print(f"Writing updated baseline to {baseline_path}...")
    with open(baseline_path, "w", encoding="utf-8") as f:
        json.dump(baseline_data, f, indent=2)
        f.write("\n")
    print("Done.")


if __name__ == "__main__":
    main()

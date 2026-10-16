#!/usr/bin/env python3
"""Unified CLI Runner and Dispatcher for Vela System-Level Evaluation Pipelines.

Implements deep module principles:
- Depth: Minimal caller interface (one command/call to run any family or all).
- Locality: Hides Promptfoo execution, DeepEval runners, RAGAS metrics, and
  custom collectors behind a uniform FamilyRunner protocol.
- Gate: Checks master gate (VELA_SYSTEM_EVALS_ENABLED) with --live override.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

# Add system-evals directory to path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from common import FamilyResult
from config import config
from dispatcher import ALL_FAMILIES, registry, run_all, run_family


def main() -> int:
    parser = argparse.ArgumentParser(description="Vela System-Level Evaluation CLI")
    parser.add_argument(
        "--family",
        choices=ALL_FAMILIES + ["all"],
        default="all",
        help="Family to evaluate (default: all)",
    )
    parser.add_argument(
        "--mode",
        choices=["smoke", "nightly"],
        default="smoke",
        help="Evaluation mode (smoke: fast subset, nightly: comprehensive)",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Force live execution bypassing the VELA_SYSTEM_EVALS_ENABLED gate",
    )
    parser.add_argument(
        "--report-dir",
        type=str,
        default=str(config.reports_dir),
        help="Directory to save JSON eval reports",
    )
    args = parser.parse_args()

    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)

    if args.family == "all":
        results = run_all(mode=args.mode, live=args.live)
        report_data = {
            "mode": args.mode,
            "live": args.live,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "results": {fam: asdict(res) for fam, res in results.items()},
        }
        report_path = report_dir / f"eval_summary_{args.mode}.json"
        with open(report_path, "w") as f:
            json.dump(report_data, f, indent=2)
        print(f"\nReport written to {report_path}")

        any_failed = any(res.status == "failed" for res in results.values())
        return 1 if any_failed else 0
    else:
        print(f"\n▶ Running Family: {args.family} (mode: {args.mode})...")
        res = run_family(args.family, mode=args.mode, live=args.live)
        status_icon = "✅" if res.status == "passed" else "❌" if res.status == "failed" else "⚠️"
        print(f"\n{status_icon} {args.family}: {res.status} ({res.passed_cases}/{res.total_cases} passed in {res.duration_s}s)")

        report_path = report_dir / f"eval_{args.family}_{args.mode}.json"
        with open(report_path, "w") as f:
            json.dump(asdict(res), f, indent=2)
        print(f"\nReport written to {report_path}")

        return 1 if res.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())

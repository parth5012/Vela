#!/usr/bin/env python3
"""
Vela Native Android Hardware & Display Profiler (18-Metric Ratchet Lane 2)
Automates measurement of:
- Cold startup latency (TotalTime via `am start -W`)
- Display jank & frame percentiles (`dumpsys gfxinfo ... framestats`)
- Dalvik & Native PSS memory growth (`dumpsys meminfo`)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Ensure stdout and stderr handle UTF-8 cleanly on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

SAMPLE_AM_START = """
Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=com.parth5012.client.dev/.MainActivity }
Status: ok
LaunchState: COLD
Activity: com.parth5012.client.dev/.MainActivity
TotalTime: 348
WaitTime: 362
Complete
"""

SAMPLE_GFXINFO = """
Applications Graphics Acceleration Info:
Uptime: 1024354 Realtime: 1024354

** GRAPHICS INFO OR com.parth5012.client.dev **

---PROFILEDATA---
Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted
0,1000000000,1000000000,0,0,1001000000,1002000000,1003000000,1005000000,1006000000,1007000000,1008000000,1009000000,1012000000
0,1016666666,1016666666,0,0,1017000000,1018000000,1019000000,1021000000,1022000000,1023000000,1024000000,1025000000,1029000000
0,1033333332,1033333332,0,0,1034000000,1035000000,1036000000,1040000000,1042000000,1044000000,1046000000,1048000000,1053000000
0,1049999998,1049999998,0,0,1051000000,1053000000,1055000000,1058000000,1060000000,1062000000,1064000000,1066000000,1071000000
---PROFILEDATA---
"""

SAMPLE_MEMINFO_BEFORE = """
Applications Memory Usage (in Kilobytes):
Uptime: 1024354 Realtime: 1024354

** MEMINFO in pid 12345 [com.parth5012.client.dev] **
                   Pss      Pss   Shared  Private  Private
                 Total    Clean    Dirty    Dirty    Clean
                ------   ------   ------   ------   ------
  Native Heap    25400        0     4000    24800        0
  Dalvik Heap    18200        0     3000    17800        0
        TOTAL    95000     4000    12000    88000     4000
"""

SAMPLE_MEMINFO_AFTER = """
Applications Memory Usage (in Kilobytes):
Uptime: 1034354 Realtime: 1034354

** MEMINFO in pid 12345 [com.parth5012.client.dev] **
                   Pss      Pss   Shared  Private  Private
                 Total    Clean    Dirty    Dirty    Clean
                ------   ------   ------   ------   ------
  Native Heap    27800        0     4000    27200        0
  Dalvik Heap    21400        0     3000    21000        0
        TOTAL   102000     4000    12000    95000     4000
"""


def parse_am_start(output: str) -> float:
    """Extract TotalTime in ms from `adb shell am start -W` output."""
    match = re.search(r"TotalTime:\s*(\d+)", output)
    if match:
        return float(match.group(1))
    match_wait = re.search(r"WaitTime:\s*(\d+)", output)
    if match_wait:
        return float(match_wait.group(1))
    return 0.0


def parse_gfxinfo_framestats(output: str) -> Tuple[float, float, int]:
    """
    Parses `dumpsys gfxinfo <package> framestats` CSV output.
    Returns (jank_frame_pct, p95_frame_ms, total_frames).
    """
    durations_ms: List[float] = []
    lines = output.strip().split("\n")
    in_profile = False
    header_indices: Dict[str, int] = {}

    for line in lines:
        line = line.strip()
        if line == "---PROFILEDATA---":
            in_profile = not in_profile
            continue
        if not in_profile:
            continue

        parts = [p.strip() for p in line.split(",")]
        if "Flags" in parts:
            header_indices = {col: idx for idx, col in enumerate(parts)}
            continue

        if not header_indices or len(parts) < len(header_indices):
            continue

        try:
            flags = int(parts[header_indices["Flags"]])
            # Flags == 0 means a normal rendered frame
            if flags != 0:
                continue

            intended_vsync = int(parts[header_indices["IntendedVsync"]])
            frame_completed = int(parts[header_indices["FrameCompleted"]])

            duration_ns = frame_completed - intended_vsync
            duration_ms = duration_ns / 1_000_000.0
            if duration_ms > 0:
                durations_ms.append(duration_ms)
        except (ValueError, KeyError):
            continue

    total_frames = len(durations_ms)
    if total_frames == 0:
        return 0.0, 0.0, 0

    jank_frames = sum(1 for d in durations_ms if d > 16.666)
    jank_pct = (jank_frames / total_frames) * 100.0

    sorted_durations = sorted(durations_ms)
    p95_idx = int(0.95 * total_frames)
    p95_idx = min(p95_idx, total_frames - 1)
    p95_frame_ms = sorted_durations[p95_idx]

    return jank_pct, p95_frame_ms, total_frames


def parse_meminfo(output: str) -> Dict[str, float]:
    """
    Extracts Pss Total for Native Heap, Dalvik Heap, and TOTAL in MB.
    """
    metrics = {"native_pss_mb": 0.0, "dalvik_pss_mb": 0.0, "total_pss_mb": 0.0}

    for line in output.split("\n"):
        line_clean = line.strip()
        if line_clean.startswith("Native Heap"):
            parts = line_clean.split()
            if len(parts) >= 3 and parts[2].isdigit():
                metrics["native_pss_mb"] = float(parts[2]) / 1024.0
        elif line_clean.startswith("Dalvik Heap"):
            parts = line_clean.split()
            if len(parts) >= 3 and parts[2].isdigit():
                metrics["dalvik_pss_mb"] = float(parts[2]) / 1024.0
        elif line_clean.startswith("TOTAL"):
            parts = line_clean.split()
            if len(parts) >= 2 and parts[1].isdigit():
                metrics["total_pss_mb"] = float(parts[1]) / 1024.0

    return metrics


def run_adb(cmd: List[str], device: Optional[str] = None) -> str:
    full_cmd = ["adb"]
    if device:
        full_cmd.extend(["-s", device])
    full_cmd.extend(cmd)
    try:
        res = subprocess.run(full_cmd, capture_output=True, text=True, check=True)
        return res.stdout
    except Exception as e:
        print(f"ADB execution failed for {full_cmd}: {e}", file=sys.stderr)
        return ""


def main():
    parser = argparse.ArgumentParser(description="Vela Android Hardware Profiler")
    parser.add_argument("--device", default="emulator-5554", help="ADB target device ID")
    parser.add_argument("--package", default="com.parth5012.client.dev", help="Target Android package")
    parser.add_argument("--activity", default=".MainActivity", help="Target Android activity")
    parser.add_argument("--dry-run", action="store_true", help="Validate fixtures and parsers without real emulator")
    parser.add_argument("--output", default="results/perf-native.json", help="Path to write native benchmark JSON")

    args = parser.parse_args()

    print(f"=== Vela Native Android Performance Profiler ===")
    print(f"Target Package: {args.package}")
    print(f"Target Device:  {args.device}")
    print(f"Dry Run Mode:   {args.dry_run}\n")

    if args.dry_run:
        print("[DRY RUN] Simulating cold startup via am start -W...")
        cold_launch_ms = parse_am_start(SAMPLE_AM_START)
        print(f"  -> Cold Launch Time: {cold_launch_ms:.1f} ms")

        print("[DRY RUN] Simulating gfxinfo framestats...")
        jank_pct, p95_frame_ms, total_frames = parse_gfxinfo_framestats(SAMPLE_GFXINFO)
        print(f"  -> Total Frames: {total_frames}, Jank%: {jank_pct:.1f}%, p95 Frame: {p95_frame_ms:.2f} ms")

        print("[DRY RUN] Simulating meminfo heap delta...")
        mem_before = parse_meminfo(SAMPLE_MEMINFO_BEFORE)
        mem_after = parse_meminfo(SAMPLE_MEMINFO_AFTER)

        dalvik_delta = round(mem_after["dalvik_pss_mb"] - mem_before["dalvik_pss_mb"], 2)
        native_delta = round(mem_after["native_pss_mb"] - mem_before["native_pss_mb"], 2)
        print(f"  -> Dalvik PSS Delta: +{dalvik_delta:.2f} MB")
        print(f"  -> Native PSS Delta: +{native_delta:.2f} MB")
    else:
        # Check adb connection
        devices_out = run_adb(["devices"])
        if args.device not in devices_out:
            print(f"Error: Target device {args.device} not found in `adb devices`:\n{devices_out}", file=sys.stderr)
            sys.exit(1)

        print(f"Measuring Cold Startup...")
        run_adb(["shell", "am", "force-stop", args.package], args.device)
        time.sleep(1)
        start_out = run_adb(["shell", "am", "start", "-W", f"{args.package}/{args.activity}"], args.device)
        cold_launch_ms = parse_am_start(start_out)
        print(f"  -> Cold Launch: {cold_launch_ms:.1f} ms")

        print(f"Resetting gfxinfo and profiling frames...")
        run_adb(["shell", "dumpsys", "gfxinfo", args.package, "reset"], args.device)
        mem_before_out = run_adb(["shell", "dumpsys", "meminfo", args.package], args.device)
        mem_before = parse_meminfo(mem_before_out)

        # Allow user interaction or simulate streaming via mock server
        print(f"Streaming scenario running (10s)...")
        time.sleep(10)

        gfx_out = run_adb(["shell", "dumpsys", "gfxinfo", args.package, "framestats"], args.device)
        jank_pct, p95_frame_ms, total_frames = parse_gfxinfo_framestats(gfx_out)

        mem_after_out = run_adb(["shell", "dumpsys", "meminfo", args.package], args.device)
        mem_after = parse_meminfo(mem_after_out)

        dalvik_delta = round(mem_after["dalvik_pss_mb"] - mem_before["dalvik_pss_mb"], 2)
        native_delta = round(mem_after["native_pss_mb"] - mem_before["native_pss_mb"], 2)

    results_data = {
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "platform": "mobile-android",
        "environment": {
            "os": "Android 14 (API 34)",
            "device": args.device,
            "build_type": "release",
            "runtime": "Hermes / React Native 0.86",
        },
        "metrics": {
            "cold_launch_to_content_ms": {
                "value": cold_launch_ms,
                "unit": "ms",
                "lower_is_better": True,
                "target": 500.0,
                "tier": 1,
                "description": "Cold application launch time (TotalTime)",
            },
            "android_jank_frame_pct": {
                "value": jank_pct,
                "unit": "pct",
                "lower_is_better": True,
                "target": 5.0,
                "tier": 1,
                "description": "Percentage of display frames exceeding 16.6ms deadline",
            },
            "p95_frame_duration_ms": {
                "value": p95_frame_ms,
                "unit": "ms",
                "lower_is_better": True,
                "target": 16.6,
                "tier": 1,
                "description": "95th percentile display frame duration",
            },
            "dalvik_pss_delta_mb": {
                "value": dalvik_delta,
                "unit": "mb",
                "lower_is_better": True,
                "tier": 2,
                "description": "Dalvik PSS memory heap growth",
            },
            "native_pss_delta_mb": {
                "value": native_delta,
                "unit": "mb",
                "lower_is_better": True,
                "tier": 2,
                "description": "Native PSS memory heap growth",
            },
        },
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results_data, f, indent=2)

    print(f"\n[OK] Native Android profile benchmark saved to {args.output}")
    sys.exit(0)


if __name__ == "__main__":
    main()

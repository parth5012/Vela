"""Re-record (or verify) the pinned transcript corpus.

Usage (from ``backend/``)::

    uv run python -m corpus.regen                 # re-record expectations + manifest
    uv run python -m corpus.regen --check         # report drift, write nothing
    uv run python -m corpus.regen --update-floors # re-record and ratchet floors up
    uv run python -m corpus.regen --only persona  # limit to matching fixtures

The script replays every fixture through the real app with ``FakeProvider``
(exactly like ``tests/test_corpus.py``), rewrites ``expected_events`` /
``expected_persisted`` / ``expected_prompt``, regenerates ``SHA256SUMS`` and
prints per-feature pass counts.

Floors are ratchets: ``--update-floors`` may only raise them. A replay that
falls below the current floor aborts the run instead of lowering it.
"""

from __future__ import annotations

import os

# ``db.session`` decides between the throwaway SQLite test database and the
# configured DATABASE_URL at import time. Recording must never touch a real
# database, so claim the pytest session marker before importing app modules.
os.environ.setdefault("PYTEST_CURRENT_TEST", "corpus.regen")

import argparse
import json
import re
import sys
from collections import Counter
from contextlib import suppress
from pathlib import Path
from typing import Any

from agent.testing.harness import DeterministicHarness
from agent.testing.provider import FakeProvider
from corpus.floors import FLOORS, reconcile, render_floors
from corpus.loader import (
    CORPUS_DIR,
    Fixture,
    compute_manifest_text,
    format_diff,
    load_all,
    normalize_events,
    normalize_persisted,
    normalize_prompt,
)
from corpus.runner import run_fixture

FLOORS_PATH = CORPUS_DIR / "floors.py"

_KEY_ORDER = (
    "feature",
    "variant",
    "description",
    "script",
    "request",
    "prior_turns",
    "prep",
    "expected_events",
    "expected_persisted",
    "expected_prompt",
)


def _ordered(raw: dict[str, Any]) -> dict[str, Any]:
    ordered = {key: raw[key] for key in _KEY_ORDER if key in raw}
    ordered.update({key: value for key, value in raw.items() if key not in ordered})
    return ordered


def _record(fixture: Fixture) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """Replay one fixture and return (expected_events, expected_persisted, expected_prompt)."""
    harness = DeterministicHarness(provider=FakeProvider(), seed=True)
    client = harness.start()
    try:
        observed = run_fixture(client, fixture)
    finally:
        harness.stop()

    events = normalize_events(observed.events, known_title=observed.known_title)
    persisted = normalize_persisted(observed.persisted)
    prompt = normalize_prompt(observed.prompt)

    if observed.remaining_script_turns:
        raise RuntimeError(
            f"{fixture.path.name}: {observed.remaining_script_turns} scripted turn(s) were never "
            f"consumed — the script no longer matches the flow"
        )
    return events, persisted, prompt


def _write_fixture(fixture: Fixture, events: list[dict], persisted: dict, prompt: str | None) -> bool:
    raw = dict(fixture.raw)
    raw["expected_events"] = events
    raw["expected_persisted"] = persisted

    expected_prompt = raw.get("expected_prompt")
    if expected_prompt:
        # Prompt markers are hand-written assertions; keep them, but fail loudly
        # when re-recording proves a marker no longer holds.
        from corpus.loader import check_prompt

        problems = check_prompt(expected_prompt, prompt)
        if problems:
            raise RuntimeError(f"{fixture.path.name}: stale prompt markers:\n  - " + "\n  - ".join(problems))

    payload = json.dumps(_ordered(raw), indent=2, ensure_ascii=False) + "\n"
    changed = payload != fixture.path.read_text(encoding="utf-8")
    if changed:
        fixture.path.write_text(payload, encoding="utf-8")
    return changed


def _update_floors_literal(floors: dict[str, int]) -> bool:
    source = FLOORS_PATH.read_text(encoding="utf-8")
    pattern = re.compile(r"FLOORS: dict\[str, int\] = \{.*?\n\}", re.DOTALL)
    if not pattern.search(source):
        raise RuntimeError(f"could not locate the FLOORS literal in {FLOORS_PATH}")
    updated = pattern.sub(render_floors(floors), source, count=1)
    if updated == source:
        return False
    FLOORS_PATH.write_text(updated, encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except (AttributeError, OSError):  # pragma: no cover - non-standard streams
            pass

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="report drift only; write nothing")
    parser.add_argument("--update-floors", action="store_true", help="ratchet floors up after re-recording")
    parser.add_argument("--only", default=None, help="only fixtures whose feature/variant contains this text")
    args = parser.parse_args(argv)

    fixtures = load_all()
    if args.only:
        fixtures = [f for f in fixtures if args.only in f.id]
    if not fixtures:
        print("corpus is empty — nothing to record", file=sys.stderr)
        return 2

    achieved: Counter[str] = Counter()
    failures: list[str] = []
    drift: list[str] = []

    for fixture in fixtures:
        try:
            events, persisted, prompt = _record(fixture)
        except Exception as exc:  # noqa: BLE001 - report every broken fixture, then fail
            failures.append(f"{fixture.id}: {exc}")
            print(f"FAIL {fixture.id}: {exc}", file=sys.stderr)
            continue

        achieved[fixture.feature] += 1

        recorded = {"events": events, "persisted": persisted}
        current = {
            "events": fixture.raw.get("expected_events"),
            "persisted": fixture.raw.get("expected_persisted"),
        }
        for label, expected, actual in (
            ("events", current["events"], recorded["events"]),
            ("persisted", current["persisted"], recorded["persisted"]),
        ):
            diff = format_diff(expected, actual, label=label)
            if diff:
                drift.append(f"{fixture.id} [{label}]\n{diff}")

        if not args.check:
            try:
                _write_fixture(fixture, events, persisted, prompt)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{fixture.id}: {exc}")
                print(f"FAIL {fixture.id}: {exc}", file=sys.stderr)

    print("\nfeature pass counts")
    print(f"{'feature':<28}{'passing':>8}{'floor':>7}")
    for feature in sorted(set(FLOORS) | set(achieved)):
        print(f"{feature:<28}{achieved.get(feature, 0):>8}{FLOORS.get(feature, 0):>7}")

    if drift:
        print(f"\n{len(drift)} expectation block(s) {'would change' if args.check else 'were re-recorded'}:")
        for entry in drift:
            print(f"- {entry}")

    if failures:
        print(f"\n{len(failures)} fixture replay(s) failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    if args.check:
        return 1 if drift else 0

    manifest_path = CORPUS_DIR / "SHA256SUMS"
    manifest_path.write_text(compute_manifest_text(), encoding="utf-8")
    print(f"\nmanifest written: {manifest_path.relative_to(CORPUS_DIR.parent)}")

    if not args.update_floors:
        print("floors unchanged (pass --update-floors to ratchet up)")
        return 0

    try:
        new_floors, report = reconcile(dict(achieved))
    except ValueError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1

    print("\nfloor ratchet")
    for line in report:
        print(f"  {line}")
    if _update_floors_literal(new_floors):
        print(f"  wrote {FLOORS_PATH.relative_to(CORPUS_DIR.parent)}")
    else:
        print("  floors already up to date")
    return 0


def _cleanup_scratch_db() -> None:
    """Remove the throwaway SQLite database created for the recording run."""
    from db.session import engine

    with suppress(Exception):
        engine.dispose()
    scratch = Path("test_vela_backend.db")
    if scratch.is_file():
        try:
            scratch.unlink()
        except OSError:  # pragma: no cover - windows file locks
            print(f"note: could not remove {scratch} (still in use)", file=sys.stderr)


if __name__ == "__main__":
    try:
        exit_code = main()
    finally:
        _cleanup_scratch_db()
    raise SystemExit(exit_code)

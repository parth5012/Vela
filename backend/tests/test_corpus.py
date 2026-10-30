"""Pinned transcript corpus: replay fixtures through the real app and diff.

Each fixture is a small, single-feature conversation (see
``corpus/transcripts/<feature>/``) that is replayed against the real FastAPI
app with ``FakeProvider`` + a frozen clock + a seeded SQLite database. The
observed SSE stream and persisted turn are normalized (see the volatility
contract in ``corpus/loader.py``) and diffed against the checked-in
expectations.

Runbook: ``corpus/README.md``.
"""

from __future__ import annotations

import pytest

from corpus.floors import FLOORS, check_floors
from corpus.loader import (
    TRANSCRIPTS_DIR,
    Fixture,
    check_prompt,
    format_diff,
    load_all,
    normalize_events,
    normalize_persisted,
    normalize_prompt,
    verify_manifest,
)
from corpus.runner import run_fixture


def test_manifest_hash_is_line_ending_independent(tmp_path):
    """Pinned content must hash the same on Windows (CRLF) and Linux (LF).

    Regression: hashing raw bytes made every fixture mismatch in CI while the
    Windows checkout passed, because git hands out different line endings.
    """
    from corpus.loader import _sha256

    crlf = tmp_path / "crlf.json"
    crlf.write_bytes(b'{\r\n  "feature": "plain-reply"\r\n}\r\n')
    lf = tmp_path / "lf.json"
    lf.write_bytes(b'{\n  "feature": "plain-reply"\n}\n')

    assert _sha256(crlf) == _sha256(lf)

pytestmark = pytest.mark.corpus

#: Secret-shaped strings that must never be committed inside a transcript.
_SECRET_MARKERS = ("sk-", "AIza", "ghp_", "xoxb-", "-----BEGIN", "test-api-key")

#: feature -> [passed, ...] for the fixtures executed in this session.
_RESULTS: dict[str, list[bool]] = {}


def _fixture_params() -> list[pytest.ParameterSet]:
    """Parametrize over the corpus, failing loudly when it is missing."""
    try:
        fixtures = load_all()
    except Exception as exc:  # noqa: BLE001 - surfaced as a failing test, never a skip
        return [pytest.param(None, id=f"UNREADABLE-CORPUS-{type(exc).__name__}")]
    if not fixtures:
        return [pytest.param(None, id="EMPTY-OR-MISSING-CORPUS")]
    return [pytest.param(fixture, id=fixture.path.stem) for fixture in fixtures]


@pytest.fixture(scope="module", autouse=True)
def _reset_results():
    _RESULTS.clear()
    yield
    _RESULTS.clear()


def _record(feature: str, passed: bool) -> None:
    _RESULTS.setdefault(feature, []).append(passed)


# ---------------------------------------------------------------------------
# 1. Manifest / corpus integrity
# ---------------------------------------------------------------------------


def test_corpus_manifest_and_integrity():
    """Every fixture is pinned by sha256, listed once, and free of secrets."""
    problems = verify_manifest()
    assert not problems, (
        "Corpus manifest verification failed (the corpus must never be trusted blindly):\n"
        + "\n".join(f"  - {problem}" for problem in problems)
        + "\n\nFix the fixture and re-pin with `uv run python -m corpus.regen`."
    )

    fixtures = load_all()
    assert fixtures, (
        f"Corpus is empty: no fixture JSON files found under {TRANSCRIPTS_DIR}. "
        "The pinned transcript corpus must ship with fixtures."
    )

    unknown_features = sorted({fixture.feature for fixture in fixtures} - set(FLOORS))
    assert not unknown_features, (
        "Fixture(s) declare feature(s) with no entry in corpus/floors.py FLOORS: "
        f"{unknown_features}. Every feature needs a floor."
    )

    for fixture in fixtures:
        text = fixture.path.read_text(encoding="utf-8")
        leaked = [marker for marker in _SECRET_MARKERS if marker in text]
        assert not leaked, f"{fixture.path.name}: fixture contains secret-shaped marker(s) {leaked}"


# ---------------------------------------------------------------------------
# 2. Per-fixture replay + diff
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("fixture", _fixture_params())
def test_corpus_fixture(fixture: Fixture | None, deterministic_app):
    """Replay one fixture and diff normalized events + persisted turn."""
    if fixture is None:
        pytest.fail(
            f"Corpus is empty or unreadable under {TRANSCRIPTS_DIR}. "
            "A missing corpus is a failure, not a skip."
        )

    try:
        observed = run_fixture(deterministic_app, fixture)
        actual_events = normalize_events(observed.events, known_title=observed.known_title)
        actual_persisted = normalize_persisted(observed.persisted)
        actual_prompt = normalize_prompt(observed.prompt)
    except Exception:
        _record(fixture.feature, False)
        raise

    problems: list[str] = []

    events_diff = format_diff(fixture.raw["expected_events"], actual_events, label="events")
    if events_diff:
        problems.append(events_diff)

    persisted_diff = format_diff(
        fixture.raw["expected_persisted"], actual_persisted, label="persisted"
    )
    if persisted_diff:
        problems.append(persisted_diff)

    if observed.remaining_script_turns:
        problems.append(
            f"  - script: {observed.remaining_script_turns} scripted turn(s) never consumed "
            f"(stale fixture script)"
        )

    problems.extend(f"  - {problem}" for problem in check_prompt(fixture.raw.get("expected_prompt"), actual_prompt))

    passed = not problems
    _record(fixture.feature, passed)

    if not passed:
        pytest.fail(
            f"Corpus fixture {fixture.id!r} drifted from its pinned transcript "
            f"({fixture.path}).\n" + "\n".join(problems) + "\n\n"
            "If the behaviour change is intentional, re-record with "
            "`uv run python -m corpus.regen` (from backend/) and review the diff."
        )


# ---------------------------------------------------------------------------
# 3. Floors
# ---------------------------------------------------------------------------


def _write_line(request: pytest.FixtureRequest, line: str) -> None:
    """Print immediately (visible without -s), falling back to stdout."""
    reporter = request.config.pluginmanager.getplugin("terminalreporter")
    if reporter is not None:
        reporter.write_line(line)
    else:  # pragma: no cover - very unusual invocation
        print(line)


def test_feature_floors(request: pytest.FixtureRequest):
    """Enforce per-feature pass floors and print the achieved rates."""
    achieved = {feature: sum(results) for feature, results in _RESULTS.items()}
    totals = {feature: len(results) for feature, results in _RESULTS.items()}

    _write_line(request, "")
    _write_line(request, "corpus pass rates (floors may only rise):")
    _write_line(request, f"  {'feature':<30}{'passed':>7}{'fixtures':>9}{'floor':>7}")
    for feature in sorted(set(FLOORS) | set(achieved)):
        _write_line(
            request,
            f"  {feature:<30}{achieved.get(feature, 0):>7}"
            f"{totals.get(feature, 0):>9}{FLOORS.get(feature, 0):>7}",
        )

    violations = check_floors(achieved)
    assert not violations, (
        "Corpus floors violated (a fixture regressed, or a feature has no floor):\n"
        + "\n".join(f"  - {violation}" for violation in violations)
        + "\n\nFix the behaviour. Floors are ratchets and may not be lowered silently; "
        "raise them only via `uv run python -m corpus.regen --update-floors`."
    )

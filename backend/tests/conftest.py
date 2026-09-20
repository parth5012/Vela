import json
import os
import time
import pytest
from db.session import engine

# Golden-eval HTML report collection: outcomes for
# tests/test_golden.py::test_golden_case_execution keyed by case id.
_GOLDEN_OUTCOMES: dict[str, dict] = {}
_GOLDEN_SUITE_STARTED: float | None = None


def _golden_case_id(item: pytest.Item) -> str | None:
    """Extract the golden case id from a parametrized test item, if any."""
    if item.function.__name__ != "test_golden_case_execution":
        return None
    callspec = getattr(item, "callspec", None)
    params = getattr(callspec, "params", {}) if callspec else {}
    case = params.get("case")
    if isinstance(case, dict) and case.get("id"):
        return str(case["id"])
    # Fallback: parametrized ids are the case ids (ids=lambda c: c["id"])
    return str(item.callspec.id) if callspec else None


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    cid = _golden_case_id(item)
    if cid is None:
        return
    if rep.when == "call":
        entry = _GOLDEN_OUTCOMES.setdefault(cid, {})
        entry["passed"] = rep.passed
        entry["duration_s"] = round(rep.duration, 2)
        if rep.failed:
            try:
                entry["error"] = str(rep.longrepr)[:2000]
            except Exception:
                entry["error"] = "test failed"
    elif rep.when in ("setup", "teardown") and rep.failed:
        entry = _GOLDEN_OUTCOMES.setdefault(cid, {})
        entry["passed"] = False
        try:
            entry["error"] = str(rep.longrepr)[:2000]
        except Exception:
            entry["error"] = f"test {rep.when} failed"


def pytest_sessionstart(session):
    global _GOLDEN_SUITE_STARTED
    _GOLDEN_SUITE_STARTED = time.monotonic()


def pytest_sessionfinish(session, exitstatus):
    if not _GOLDEN_OUTCOMES:
        return
    try:
        from pathlib import Path

        from evals.report import save_suite_results

        golden_path = Path(__file__).resolve().parent.parent / "evals" / "golden.jsonl"
        by_id: dict[str, dict] = {}
        if golden_path.exists():
            with open(golden_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        case = json.loads(line)
                        by_id[case["id"]] = case

        report_cases = []
        for cid, outcome in sorted(_GOLDEN_OUTCOMES.items()):
            src = by_id.get(cid, {})
            inp = src.get("input", {})
            ok = bool(outcome.get("passed"))
            report_cases.append({
                "id": cid,
                "family": src.get("family", "unknown"),
                "suite": "golden_mocked",
                "status": "passed" if ok else "failed",
                "score": None,
                "reasoning": (
                    "Dual-oracle mocked run passed: supervisor route + SSE streaming contract."
                    if ok else (outcome.get("error") or "Dual-oracle mocked run failed.")
                ),
                "passed": ok,
                "mocked": True,
                "judge_model": None,
                "message": inp.get("message", ""),
                "persona": inp.get("persona") or "personal assistant",
                "thread_history": inp.get("thread_history", []),
                "auth_state": inp.get("auth_state", {}),
                "expected": src.get("expected_supervisor", {}),
                "expected_sse": src.get("expected_sse"),
                "actual_response": "",
                "duration_s": outcome.get("duration_s"),
                "error": None if ok else outcome.get("error"),
            })

        duration_s = (
            round(time.monotonic() - _GOLDEN_SUITE_STARTED, 2)
            if _GOLDEN_SUITE_STARTED else None
        )
        path = save_suite_results("golden_mocked", report_cases, duration_s=duration_s)
        print(f"\nHTML eval report updated: {path}")
    except Exception as e:
        print(f"\nWarning: failed to write golden HTML eval report ({e})")
    finally:
        _GOLDEN_OUTCOMES.clear()

@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db():
    yield
    
    # Dispose of the SQLAlchemy engine to close all connections
    try:
        engine.dispose()
    except Exception:
        pass
        
    db_file = "test_vela_backend.db"
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
        except Exception as e:
            print(f"Failed to remove test database file {db_file}: {e}")

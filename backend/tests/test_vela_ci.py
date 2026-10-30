"""Self-tests for the `vela ci` gate (repo-root ``vela_ci.py``).

The gate is the single definition of "green", so it is tested like any other
production surface: argument parsing, step wiring, compact failure summaries,
environment guards, and the bug-registry validator.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
VELA_CI_PATH = REPO_ROOT / "vela_ci.py"


def _load_gate():
    spec = importlib.util.spec_from_file_location("vela_ci", VELA_CI_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # `dataclasses` resolves string annotations through `sys.modules`, so the
    # module must be registered before execution or the dataclass decorators
    # raise AttributeError on a None module.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def gate():
    assert VELA_CI_PATH.is_file(), "vela_ci.py must live at the repo root"
    return _load_gate()


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def test_parser_defaults_to_full_ci_without_e2e(gate):
    args = gate.build_parser().parse_args(["ci"])
    assert args.command == "ci"
    assert args.stack == "all"
    assert args.with_e2e is False
    assert gate.stacks_for(args) == ["backend", "client", "corpus", "bugs"]


def test_parser_accepts_stack_and_e2e_flags(gate):
    args = gate.build_parser().parse_args(["ci", "--stack", "backend", "--with-e2e"])
    assert gate.stacks_for(args) == ["backend"]

    args = gate.build_parser().parse_args(["ci", "--with-e2e"])
    assert gate.stacks_for(args) == ["backend", "client", "corpus", "bugs", "e2e"]


@pytest.mark.parametrize("command", ["corpus", "e2e", "bugs"])
def test_parser_accepts_single_purpose_subcommands(gate, command):
    args = gate.build_parser().parse_args([command])
    assert gate.stacks_for(args) == [command]


def test_parser_rejects_unknown_stack(gate):
    with pytest.raises(SystemExit):
        gate.build_parser().parse_args(["ci", "--stack", "frontend"])


# ---------------------------------------------------------------------------
# Step wiring
# ---------------------------------------------------------------------------


def test_backend_steps_run_pytest_in_backend(gate):
    steps = gate.build_steps("backend")
    names = [step.name for step in steps]
    assert names == ["pytest", "ruff"]
    pytest_step = steps[0]
    assert pytest_step.cwd == REPO_ROOT / "backend"
    assert pytest_step.cmd[:3] == ["uv", "run", "pytest"]
    assert pytest_step.env["DATABASE_URL"].startswith("sqlite")


def test_client_steps_cover_lint_typecheck_and_tests(gate):
    steps = gate.build_steps("client")
    assert [step.name for step in steps] == ["eslint", "tsc", "jest"]
    for step in steps:
        assert step.cwd == REPO_ROOT / "client"


def test_corpus_step_uses_the_corpus_mark(gate):
    (step,) = gate.build_steps("corpus")
    assert step.cmd[:6] == ["uv", "run", "pytest", "-m", "corpus", "tests/test_corpus.py"]
    assert step.cwd == REPO_ROOT / "backend"


def test_unknown_stack_is_rejected(gate):
    with pytest.raises(gate.GateError):
        gate.build_steps("frontend")


def test_changed_python_files_are_relative_to_backend(gate, monkeypatch):
    """Regression: ruff runs with cwd=backend/, so repo-relative paths from
    `git diff` (``backend/agent/...``) failed with E902. Paths must resolve
    from the backend directory."""

    class FakeCompleted:
        def __init__(self, stdout: str = "") -> None:
            self.returncode = 0
            self.stdout = stdout

    def fake_run(cmd, **_kwargs):
        if "rev-parse" in cmd:
            return FakeCompleted()
        return FakeCompleted(stdout="backend/agent/graph.py\nbackend/tests/test_api.py\n")

    monkeypatch.setattr(gate.subprocess, "run", fake_run)
    files = gate._changed_python_files("origin/main")

    assert not isinstance(files, str)
    assert [Path(name) for name in files] == [Path("agent/graph.py"), Path("tests/test_api.py")]
    for name in files:
        assert (gate.BACKEND_DIR / name).is_file()


# ---------------------------------------------------------------------------
# Ruff ratchet (changed lines only)
# ---------------------------------------------------------------------------


def test_changed_line_ranges_track_new_side_hunks(gate, monkeypatch):
    diff = (
        "diff --git a/backend/agent/graph.py b/backend/agent/graph.py\n"
        "--- a/backend/agent/graph.py\n"
        "+++ b/backend/agent/graph.py\n"
        "@@ -10,0 +11,3 @@\n"
        "+one\n"
        "+two\n"
        "+three\n"
        "@@ -40 +43 @@\n"
        "-old\n"
        "+new\n"
        "@@ -90,4 +92,0 @@\n"
        "-gone\n"
    )

    class FakeCompleted:
        returncode = 0

        def __init__(self, stdout: str) -> None:
            self.stdout = stdout

    monkeypatch.setattr(gate.subprocess, "run", lambda *_a, **_k: FakeCompleted(diff))
    ranges = gate._changed_line_ranges("origin/main")

    assert not isinstance(ranges, str)
    (path, spans), = ranges.items()
    assert path == (gate.ROOT / "backend/agent/graph.py").resolve()
    # Pure deletions (the third hunk) touch no new-side line.
    assert spans == [(11, 13), (43, 43)]


def test_changed_line_ranges_skip_deleted_files(gate, monkeypatch):
    diff = (
        "--- a/backend/agent/old.py\n"
        "+++ /dev/null\n"
        "@@ -1,2 +0,0 @@\n"
        "-a\n"
        "-b\n"
    )

    class FakeCompleted:
        returncode = 0
        stdout = diff

    monkeypatch.setattr(gate.subprocess, "run", lambda *_a, **_k: FakeCompleted())
    assert gate._changed_line_ranges("origin/main") == {}


def test_filter_findings_ignores_pre_existing_debt(gate):
    touched = (gate.ROOT / "backend/agent/graph.py").resolve()
    spans = {touched: [(11, 13)]}
    findings = [
        {"filename": str(touched), "location": {"row": 5}, "code": "I001", "message": "legacy"},
        {"filename": str(touched), "location": {"row": 12}, "code": "F811", "message": "new"},
        {"filename": str(gate.ROOT / "backend/agent/other.py"), "location": {"row": 12}, "code": "E501", "message": "untouched file"},
    ]

    kept = gate.filter_findings(findings, spans)
    assert [finding["message"] for finding in kept] == ["new"]


def test_ruff_step_delegates_to_the_driver(gate):
    (pytest_step, ruff_step) = gate.build_steps("backend")
    assert pytest_step.name == "pytest"
    assert ruff_step.name == "ruff"
    assert ruff_step.cmd[1] == str(gate.ROOT / "vela_ci.py")
    assert ruff_step.cmd[-2:] == ["--base", gate.DEFAULT_RUFF_BASE]


def test_summary_extracts_python_lint_pointers(gate):
    output = "backend\\agent\\graph.py:12: F811 redefinition of unused 'helper'"
    assert gate.summarize_output(output) == [output]


# ---------------------------------------------------------------------------
# Compact failure summary (no log dumps)
# ---------------------------------------------------------------------------


def test_summary_extracts_pytest_failures_only(gate):
    output = (
        "collected 40 items\n"
        "....\n"
        "FAILED tests/test_api.py::test_thread_rename - AssertionError: 500 != 200\n"
        "ERROR tests/test_graph.py::test_build - RuntimeError: boom\n"
        "= 1 failed, 1 error, 38 passed in 2.0s"
    )
    summary = gate.summarize_output(output)
    assert any("tests/test_api.py::test_thread_rename" in line for line in summary)
    assert any("tests/test_graph.py::test_build" in line for line in summary)
    assert not any("collected 40 items" in line for line in summary)


def test_summary_extracts_typescript_and_eslint_pointers(gate):
    output = (
        "app/index.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\n"
        "\n"
        "  12:5  error  Unexpected any  @typescript-eslint/no-explicit-any\n"
        "✖ 1 problem (1 error, 0 warnings)"
    )
    summary = gate.summarize_output(output)
    assert any("error TS2322" in line for line in summary)
    assert any("no-explicit-any" in line for line in summary)


def test_summary_is_capped(gate):
    output = "\n".join(f"FAILED tests/test_{index}.py::test_case - boom" for index in range(200))
    summary = gate.summarize_output(output, limit=5)
    assert len(summary) == 5


def test_summary_falls_back_to_tail_when_nothing_matches(gate):
    output = "step one\nstep two\nstep three"
    assert gate.summarize_output(output) == ["step one", "step two", "step three"]


# ---------------------------------------------------------------------------
# Environment guards (never silently pass a broken environment)
# ---------------------------------------------------------------------------


def test_missing_tool_raises_precise_error(gate, monkeypatch):
    monkeypatch.setattr(gate.shutil, "which", lambda _tool: None)
    with pytest.raises(gate.GateError, match="not found on PATH"):
        gate.require_tool("uv", "Install uv.")


def test_main_exits_two_on_broken_environment(gate, monkeypatch):
    monkeypatch.setattr(gate.shutil, "which", lambda _tool: None)
    assert gate.main(["ci", "--stack", "backend"]) == 2


def test_check_environment_requires_client_dependencies(gate, monkeypatch):
    real_is_dir = Path.is_dir

    def fake_is_dir(self):
        if self.name == "node_modules":
            return False
        return real_is_dir(self)

    monkeypatch.setattr(gate.shutil, "which", lambda tool: f"/usr/bin/{tool}")
    monkeypatch.setattr(Path, "is_dir", fake_is_dir)
    with pytest.raises(gate.GateError, match="pnpm install"):
        gate.check_environment(["client"])


# ---------------------------------------------------------------------------
# Bug registry
# ---------------------------------------------------------------------------


def test_shipped_registry_is_valid(gate):
    text = (REPO_ROOT / "BUGS.toml").read_text(encoding="utf-8")
    assert gate.validate_bugs_registry(text) == []


def test_shipped_registry_has_at_least_two_entries(gate):
    text = (REPO_ROOT / "BUGS.toml").read_text(encoding="utf-8")
    assert len(gate._parse_toml_sections(text)) >= 2


def test_registry_rejects_bad_id_missing_fields_and_fixed_without_test(gate):
    text = (
        "[BUG-1]\n"
        'title = "bad id"\n'
        'status = "open"\n'
        'repro_steps = ["do a thing"]\n'
        "\n"
        "[BUG-backend-099]\n"
        'title = "fixed but untested"\n'
        'status = "fixed"\n'
        'repro_steps = ["do a thing"]'
    )
    problems = gate.validate_bugs_registry(text)
    assert any("must match [BUG-<domain>-<n>]" in problem for problem in problems)
    assert any("failing_test" in problem for problem in problems)


def test_registry_rejects_unknown_status(gate):
    text = (
        "[BUG-client-042]\n"
        'title = "weird status"\n'
        'status = "done-ish"\n'
        'repro_steps = ["do a thing"]'
    )
    assert any("must be one of" in problem for problem in gate.validate_bugs_registry(text))


def test_bugs_command_passes_on_the_real_registry(gate):
    assert gate.main(["bugs"]) == 0

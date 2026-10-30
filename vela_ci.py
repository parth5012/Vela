#!/usr/bin/env python
"""`vela ci` — the single definition of "the build is green".

Locally, in GitHub Actions and in agent loops the same command is used:

    python vela_ci.py ci                 # backend + client + corpus + bug registry
    python vela_ci.py ci --with-e2e      # ... plus the Playwright UI e2e suite
    python vela_ci.py ci --stack backend # one stack only
    python vela_ci.py corpus             # corpus fixtures + pass floors only
    python vela_ci.py e2e                # Playwright UI e2e only
    python vela_ci.py bugs               # validate BUGS.toml (no tests run)

Deliberately dependency-free (Python stdlib only) so it runs on Windows and
Linux the same way, and so a broken environment fails with a precise message
instead of a confusing traceback.

Exit codes: 0 = green, 1 = at least one step failed, 2 = bad invocation or
broken environment (missing uv/npm/node_modules/registry).

Full step output is written to `.tmp/vela-ci/<step>.log`; the console only
gets a compact failure summary (file:line pointers), never a log dump.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
CLIENT_DIR = ROOT / "client"
LOG_DIR = ROOT / ".tmp" / "vela-ci"
DEFAULT_BUGS_FILE = ROOT / "BUGS.toml"
DEFAULT_RUFF_BASE = "origin/main"

STACKS = ("backend", "client", "corpus", "e2e", "bugs")

#: Env every backend pytest invocation needs (mirrors `.github/workflows/ci.yml`).
BACKEND_ENV = {
    "DATABASE_URL": "sqlite:///test_vela_backend.db",
    "VELA_API_KEY": "vela5012",
    "GOOGLE_API_KEY": "dummy-ci-key",
    "JWT_SECRET": "dummy-ci-jwt-secret",
    "PYTHONPATH": ".",
}

_MAX_SUMMARY_LINES = 40


class GateError(RuntimeError):
    """A broken environment or bad invocation — exit code 2, never a pass."""


@dataclass
class Step:
    name: str
    cmd: list[str]
    cwd: Path
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class StepResult:
    step: Step
    returncode: int
    output: str
    seconds: float
    log_path: Path | None = None
    skipped: str | None = None

    @property
    def ok(self) -> bool:
        return self.skipped is not None or self.returncode == 0


# ---------------------------------------------------------------------------
# Environment checks (fail fast, precisely)
# ---------------------------------------------------------------------------


def require_tool(tool: str, hint: str) -> str:
    """Resolve an executable or raise a GateError naming the fix."""
    resolved = shutil.which(tool)
    if resolved is None:
        raise GateError(f"`{tool}` not found on PATH. {hint}")
    return resolved


def require_dir(path: Path, hint: str) -> None:
    if not path.is_dir():
        raise GateError(f"missing {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}. {hint}")


def check_environment(stacks: list[str]) -> None:
    """Validate every prerequisite for the requested stacks up front."""
    if any(stack in ("backend", "corpus") for stack in stacks):
        require_tool("uv", "Install uv: https://docs.astral.sh/uv/getting-started/installation/")
        require_dir(BACKEND_DIR, "Run the gate from a full checkout.")
    if any(stack in ("client", "e2e") for stack in stacks):
        require_tool("npm", "Install Node.js 20+ (npm ships with it).")
        require_dir(CLIENT_DIR, "Run the gate from a full checkout.")
        if not (CLIENT_DIR / "node_modules").is_dir():
            raise GateError(
                "client/node_modules is missing. Run `pnpm install` in client/ first "
                "(the gate never installs dependencies for you)."
            )
    if "e2e" in stacks and not (CLIENT_DIR / "node_modules" / "@playwright" / "test").is_dir():
        raise GateError(
            "Playwright is not installed. Run `npx playwright install chromium` in client/."
        )
    if "bugs" in stacks and not DEFAULT_BUGS_FILE.is_file():
        raise GateError(f"missing bug registry: {DEFAULT_BUGS_FILE.name}")


# ---------------------------------------------------------------------------
# Step definitions
# ---------------------------------------------------------------------------


def _changed_python_files(base: str) -> list[str] | str:
    """Python files changed vs `base`, or a skip reason string."""
    if shutil.which("git") is None:
        return "git not available, cannot diff-scope ruff"
    try:
        probe = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", base],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:  # pragma: no cover - defensive
        return f"git failed ({exc})"
    if probe.returncode != 0:
        return f"base ref {base!r} not found (fetch it, or pass --ruff-base)"
    diff = subprocess.run(
        ["git", "diff", "--name-only", f"{base}...HEAD", "--", "*.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if diff.returncode != 0:
        return "git diff failed"
    files = [line.strip() for line in diff.stdout.splitlines() if line.strip()]
    if not files:
        return f"no Python files changed vs {base}"
    # `git diff` is repo-relative, but the ruff step runs with cwd=BACKEND_DIR,
    # so emit paths relative to backend/ (a root-relative path would otherwise
    # be read as backend/backend/... and fail with E902).
    return [os.path.relpath(ROOT / name, BACKEND_DIR) for name in files]


#: `@@ -old,count +new,count @@` — group 1 is the new-side start, group 2 the count.
_HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
_PY_POINTER_RE = re.compile(r"^[^\s:]+\.py:\d+:\s+[A-Z]+\d+")


def _changed_line_ranges(base: str) -> dict[Path, list[tuple[int, int]]] | str:
    """New-side line ranges this change touches, keyed by absolute path.

    Returns a skip/error reason string when git cannot answer.
    """
    if shutil.which("git") is None:
        return "git not available, cannot diff-scope ruff"
    diff = subprocess.run(
        ["git", "diff", "--unified=0", "--no-color", f"{base}...HEAD", "--", "*.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if diff.returncode != 0:
        return f"git diff against {base!r} failed"

    ranges: dict[Path, list[tuple[int, int]]] = {}
    current: Path | None = None
    for raw in diff.stdout.splitlines():
        if raw.startswith("+++ "):
            target = raw[4:].strip()
            if target == "/dev/null":  # deleted file — nothing new to lint
                current = None
                continue
            relative = target.removeprefix("b/")
            current = (ROOT / relative).resolve()
            ranges.setdefault(current, [])
            continue
        if current is None or not raw.startswith("@@ "):
            continue
        match = _HUNK_RE.match(raw)
        if match is None:
            continue
        start = int(match.group(1))
        count = int(match.group(2)) if match.group(2) is not None else 1
        if count > 0:
            ranges[current].append((start, start + count - 1))
    return {path: spans for path, spans in ranges.items() if spans}


def filter_findings(
    findings: list[dict],
    spans_by_path: dict[Path, list[tuple[int, int]]],
) -> list[dict]:
    """Keep only ruff findings that land on a line this change touched.

    Pre-existing debt in a file the change happens to edit must not block the
    gate; new or rewritten lines must be clean.
    """
    kept: list[dict] = []
    for finding in findings:
        path = Path(str(finding.get("filename", ""))).resolve()
        spans = spans_by_path.get(path)
        if not spans:
            continue
        location = finding.get("location") or {}
        row = int(location.get("row", 0) or 0)
        if any(low <= row <= high for low, high in spans):
            kept.append(finding)
    return kept


def run_ruff_changed(base: str = DEFAULT_RUFF_BASE) -> int:
    """Fail only on ruff findings introduced by this change.

    `ruff check .` is not usable as a hard gate yet (the repo carries hundreds
    of pre-existing findings across untouched files), and plain diff-scoped
    `ruff check <changed files>` would blame the change for all of that debt.
    So ruff runs on the changed files, and only diagnostics on the lines this
    change actually touched are blocking. Debt can shrink file by file without
    a flag day, and new code cannot add any.
    """
    changed = _changed_python_files(base)
    if isinstance(changed, str):
        if changed.startswith("no Python files changed"):
            print(f"ruff: skipped ({changed})")
            return 0
        print(f"ruff: {changed}", file=sys.stderr)
        return 2

    spans_by_path = _changed_line_ranges(base)
    if isinstance(spans_by_path, str):
        print(f"ruff: {spans_by_path}", file=sys.stderr)
        return 2

    require_tool("uv", "Install uv: https://docs.astral.sh/uv/getting-started/installation/")

    completed = subprocess.run(
        ["uv", "run", "ruff", "check", "--output-format=json", *changed],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    stdout = (completed.stdout or "").strip()
    if completed.returncode not in (0, 1) or not stdout.startswith("["):
        print(completed.stdout or "", end="", file=sys.stderr)
        print(completed.stderr or "", end="", file=sys.stderr)
        print("ruff: could not read ruff's JSON output", file=sys.stderr)
        return 2

    findings = json.loads(stdout)
    blocking = filter_findings(findings, spans_by_path)
    total = len(findings)
    if not blocking:
        ignored = f", {total} pre-existing finding(s) ignored" if total else ""
        print(f"ruff: clean on changed lines{ignored}")
        return 0

    print(f"ruff: {len(blocking)} finding(s) on changed lines (of {total} in these files)", file=sys.stderr)
    for finding in blocking:
        location = finding.get("location") or {}
        filename = os.path.relpath(str(finding.get("filename", "")), ROOT)
        print(
            f"{filename}:{location.get('row', 0)}: "
            f"{finding.get('code', '?')} {finding.get('message', '')}",
            file=sys.stderr,
        )
    return 1


def build_steps(stack: str, *, ruff_base: str = DEFAULT_RUFF_BASE) -> list[Step]:
    """Return the ordered steps for one stack."""
    if stack == "backend":
        return [
            Step(
                name="pytest",
                cmd=["uv", "run", "pytest", "-q"],
                cwd=BACKEND_DIR,
                env=BACKEND_ENV,
            ),
            Step(
                name="ruff",
                # A subprocess (not an inline call) so the run is logged and
                # summarized exactly like every other step. See run_ruff_changed
                # for why it is a changed-line ratchet rather than plain
                # `ruff check .` (the repo carries ~450 pre-existing findings).
                cmd=[sys.executable, str(ROOT / "vela_ci.py"), "_ruff", "--base", ruff_base],
                cwd=ROOT,
            ),
        ]
    if stack == "corpus":
        return [
            Step(
                name="corpus",
                cmd=["uv", "run", "pytest", "-m", "corpus", "tests/test_corpus.py", "-q"],
                cwd=BACKEND_DIR,
                env=BACKEND_ENV,
            )
        ]
    if stack == "client":
        return [
            Step(name="eslint", cmd=["npm", "run", "lint"], cwd=CLIENT_DIR),
            Step(name="tsc", cmd=["npx", "tsc", "--noEmit"], cwd=CLIENT_DIR),
            Step(name="jest", cmd=["npx", "jest", "--ci", "--maxWorkers=2"], cwd=CLIENT_DIR),
        ]
    if stack == "e2e":
        return [Step(name="playwright", cmd=["npx", "playwright", "test"], cwd=CLIENT_DIR)]
    if stack == "bugs":
        return []
    raise GateError(f"unknown stack {stack!r}; expected one of {STACKS}")


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

_TS_LINE = re.compile(r"^\S+\.(?:ts|tsx|js|jsx):\d+:\d+\b")
_FAIL_PATTERNS = (
    re.compile(r"^(?:FAILED|ERROR)\s+\S+"),
    re.compile(r"^FAIL\s+\S+"),
    re.compile(r"^\s*✘\s+\S+"),
    re.compile(r"^E\s{2,}\S+"),
    re.compile(r"^-->\s+\S+"),
    re.compile(r"error (?:TS|E\d+)"),
    re.compile(r"^\s*\d+:\d+\s+error\s+"),
)


def summarize_output(output: str, *, limit: int = _MAX_SUMMARY_LINES) -> list[str]:
    """Extract compact failure pointers from a step's raw output.

    Keeps `file:line`, pytest `FAILED`, jest `FAIL`, playwright `✘` and
    traceback `E ...` lines; falls back to the tail of the output when nothing
    matches. Never returns more than `limit` lines.
    """
    lines = [line.rstrip() for line in output.splitlines()]
    picked: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        matches = (
            any(pattern.search(stripped) for pattern in _FAIL_PATTERNS)
            or _TS_LINE.match(stripped)
            or _PY_POINTER_RE.match(stripped)
        )
        if matches and stripped not in picked:
            picked.append(stripped)
    if not picked:
        tail = [line for line in lines if line.strip()][-limit:]
        return tail
    return picked[-limit:]


def _resolve_cmd(step: Step) -> list[str]:
    resolved = list(step.cmd)
    tool = shutil.which(resolved[0])
    if tool is None:  # pragma: no cover - guarded by check_environment
        raise GateError(f"`{resolved[0]}` disappeared from PATH")
    resolved[0] = tool
    return resolved


def run_step(step: Step, *, log_dir: Path = LOG_DIR) -> StepResult:
    """Run one step with captured output; write the full log to `log_dir`."""
    started = time.perf_counter()
    skip_reason = step.env.get("__skip__")
    if skip_reason:
        return StepResult(step, 0, "", 0.0, None, skipped=skip_reason)

    env = {**os.environ, **{k: v for k, v in step.env.items() if k != "__skip__"}}
    try:
        completed = subprocess.run(
            _resolve_cmd(step),
            cwd=step.cwd,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError as exc:
        raise GateError(f"failed to start `{' '.join(step.cmd)}`: {exc}") from exc

    output = (completed.stdout or "") + (completed.stderr or "")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{step.name}.log"
    log_path.write_text(output, encoding="utf-8")
    return StepResult(
        step=step,
        returncode=completed.returncode,
        output=output,
        seconds=time.perf_counter() - started,
        log_path=log_path,
    )


# ---------------------------------------------------------------------------
# Bug registry
# ---------------------------------------------------------------------------

_SECTION_RE = re.compile(r"^\[(?P<name>[^\]]+)\]\s*$")
_BUG_ID_RE = re.compile(r"^BUG-(?P<domain>[a-z][a-z0-9]*)-(?P<number>\d{3,})$")
_VALID_STATUS = {"open", "mitigated", "fixed"}


def _parse_toml_sections(text: str) -> dict[str, dict[str, str]]:
    """Minimal TOML section reader (flat `key = value` tables, stdlib only).

    The registry only needs flat tables, so this avoids depending on `tomllib`
    (Python 3.11+) or third-party parsers on older interpreters.
    """
    sections: dict[str, dict[str, str]] = {}
    current: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = _SECTION_RE.match(line)
        if match:
            current = match.group("name").strip()
            sections[current] = {}
            continue
        if current is None or "=" not in line:
            continue
        key, _, value = line.partition("=")
        sections[current][key.strip()] = value.strip().strip('"')
    return sections


def validate_bugs_registry(text: str) -> list[str]:
    """Return human-readable problems with a `BUGS.toml` body (empty = valid)."""
    problems: list[str] = []
    sections = _parse_toml_sections(text)
    if not sections:
        return ["registry has no [BUG-<domain>-<n>] entries"]

    for name, body in sections.items():
        if not _BUG_ID_RE.match(name):
            problems.append(f"[{name}]: id must match [BUG-<domain>-<n>] (e.g. [BUG-backend-001])")
        for required in ("title", "status", "repro_steps"):
            if not body.get(required):
                problems.append(f"[{name}]: missing required key `{required}`")
        status = body.get("status", "")
        if status and status not in _VALID_STATUS:
            problems.append(f"[{name}]: status {status!r} must be one of {sorted(_VALID_STATUS)}")
        if status == "fixed" and not body.get("failing_test"):
            problems.append(
                f"[{name}]: status=fixed requires `failing_test` "
                "(a bugfix PR must ship a test that failed before the fix)"
            )
        fixed_in_pr = body.get("fixed_in_pr", "")
        if fixed_in_pr and not fixed_in_pr.isdigit():
            problems.append(f"[{name}]: fixed_in_pr must be a PR number")
    return problems


def run_bugs_check(path: Path = DEFAULT_BUGS_FILE) -> StepResult:
    step = Step(name="bugs", cmd=[], cwd=ROOT)
    started = time.perf_counter()
    if not path.is_file():
        return StepResult(step, 2, f"missing {path.name}", time.perf_counter() - started)
    problems = validate_bugs_registry(path.read_text(encoding="utf-8"))
    elapsed = time.perf_counter() - started
    if problems:
        return StepResult(step, 1, "\n".join(problems), elapsed)
    return StepResult(step, 0, "", elapsed)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vela_ci.py",
        description="Vela's single CI gate: one command for local, CI and agent runs.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    ci = subparsers.add_parser("ci", help="run the full gate (backend + client + corpus + registry)")
    ci.add_argument("--stack", default="all", choices=(*STACKS, "all"))
    ci.add_argument("--with-e2e", action="store_true", help="include the Playwright UI e2e suite")
    ci.add_argument("--ruff-base", default=DEFAULT_RUFF_BASE, help="git ref ruff diffs against")

    for name, help_text in (
        ("corpus", "run the pinned transcript corpus + pass floors"),
        ("e2e", "run the Playwright UI e2e suite"),
        ("bugs", "validate BUGS.toml"),
    ):
        subparsers.add_parser(name, help=help_text)

    # Internal: the backend stack's ruff step. Not part of STACKS because it is
    # only meaningful as a step of `ci`.
    ruff = subparsers.add_parser("_ruff", help=argparse.SUPPRESS)
    ruff.add_argument("--base", default=DEFAULT_RUFF_BASE, help="git ref to diff against")

    return parser


def stacks_for(args: argparse.Namespace) -> list[str]:
    if args.command not in STACKS + ("ci",):
        return []
    if args.command != "ci":
        return [args.command]
    if args.stack != "all":
        return [args.stack]
    stacks = ["backend", "client", "corpus", "bugs"]
    if args.with_e2e:
        stacks.append("e2e")
    return stacks


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "_ruff":
        try:
            return run_ruff_changed(args.base)
        except GateError as exc:
            print(f"vela ci: environment error: {exc}", file=sys.stderr)
            return 2

    stacks = stacks_for(args)

    try:
        check_environment(stacks)
    except GateError as exc:
        print(f"vela ci: environment error: {exc}", file=sys.stderr)
        return 2

    results: list[StepResult] = []
    for stack in stacks:
        if stack == "bugs":
            results.append(run_bugs_check())
            continue
        for step in build_steps(stack, **({"ruff_base": args.ruff_base} if stack == "backend" else {})):
            print(f"vela ci: {stack}/{step.name} ... ", end="", flush=True)
            result = run_step(step)
            results.append(result)
            if result.skipped:
                print(f"skipped ({result.skipped})")
            elif result.ok:
                print(f"ok ({result.seconds:.1f}s)")
            else:
                print(f"FAILED ({result.seconds:.1f}s)")

    failures = [result for result in results if not result.ok]
    executed = [result for result in results if result.skipped is None]
    total = sum(result.seconds for result in executed)

    if not failures:
        print(f"\nvela ci: green — {len(executed)} step(s) in {total:.1f}s")
        return 0

    print(f"\nvela ci: FAILED — {len(failures)} of {len(executed)} step(s)", file=sys.stderr)
    for result in failures:
        label = result.step.name
        print(f"\n[{label}] exit {result.returncode}", file=sys.stderr)
        for line in summarize_output(result.output):
            print(f"  {line}", file=sys.stderr)
        if result.log_path is not None:
            print(f"  full log: {result.log_path}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

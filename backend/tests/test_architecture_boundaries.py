"""Automated architecture boundary tests for backend.

Enforces forbidden import rules from docs/ARCHITECTURE_CONTRACT.md.
"""

import ast
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def get_imports_from_file(file_path: Path) -> list[str]:
    """Parse python file and extract imported module names."""
    try:
        content = file_path.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=str(file_path))
    except Exception:
        return []

    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported.append(node.module)
    return imported


def check_directory_forbidden_prefixes(sub_dir: str, forbidden_prefixes: tuple[str, ...]) -> list[str]:
    """Verify that no python files in sub_dir import modules matching forbidden prefixes."""
    violations: list[str] = []
    target_dir = BACKEND_DIR / sub_dir if sub_dir else BACKEND_DIR
    if not target_dir.is_dir():
        return violations

    for py_file in target_dir.rglob("*.py"):
        # Ignore virtualenvs, test files, ideas, scratch dirs
        parts = py_file.parts
        if any(ignored in parts for ignored in (".venv", "venv", "tests", "scratch", "ideas")):
            continue
        imports = get_imports_from_file(py_file)
        for imp in imports:
            for prefix in forbidden_prefixes:
                if imp == prefix or imp.startswith(f"{prefix}."):
                    rel = py_file.relative_to(BACKEND_DIR)
                    violations.append(f"{rel} imports forbidden module '{imp}'")
    return violations


def test_utils_boundary():
    """backend/utils/** must not import agent, tools, skills, gateway, or cron."""
    forbidden = ("agent", "tools", "skills", "gateway", "cron")
    violations = check_directory_forbidden_prefixes("utils", forbidden)
    assert not violations, f"Architecture contract violations in utils:\n" + "\n".join(violations)


def test_db_boundary():
    """backend/db/** must not import agent, gateway, tools, skills, or cron."""
    forbidden = ("agent", "gateway", "tools", "skills", "cron")
    violations = check_directory_forbidden_prefixes("db", forbidden)
    assert not violations, f"Architecture contract violations in db:\n" + "\n".join(violations)


def test_tools_boundary():
    """backend/tools/** must not import agent, gateway, or cron."""
    forbidden = ("agent", "gateway", "cron")
    violations = check_directory_forbidden_prefixes("tools", forbidden)
    assert not violations, f"Architecture contract violations in tools:\n" + "\n".join(violations)


def test_skills_boundary():
    """backend/skills/** must not import agent, gateway, or cron."""
    forbidden = ("agent", "gateway", "cron")
    violations = check_directory_forbidden_prefixes("skills", forbidden)
    assert not violations, f"Architecture contract violations in skills:\n" + "\n".join(violations)


def test_gateway_boundary():
    """backend/gateway/** must not import tools or skills."""
    forbidden = ("tools", "skills")
    violations = check_directory_forbidden_prefixes("gateway", forbidden)
    assert not violations, f"Architecture contract violations in gateway:\n" + "\n".join(violations)


def test_no_backend_to_client_imports():
    """backend/** must not import client (the frontend react native codebase)."""
    # Specifically check if any file imports from the root client directory
    violations: list[str] = []
    for py_file in BACKEND_DIR.rglob("*.py"):
        parts = py_file.parts
        if any(ignored in parts for ignored in (".venv", "venv", "tests", "scratch", "ideas")):
            continue
        imports = get_imports_from_file(py_file)
        for imp in imports:
            # db.client is a python module; client itself as root is forbidden
            if imp.startswith("client."):
                rel = py_file.relative_to(BACKEND_DIR)
                violations.append(f"{rel} imports frontend '{imp}'")
    assert not violations, f"Backend imports client:\n" + "\n".join(violations)

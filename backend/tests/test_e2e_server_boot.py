"""The deterministic UI e2e server must boot in a bare environment.

Regression: `python -m agent.testing.e2e_server` crashed in CI with
`ValueError: DATABASE_URL is not set` — the package's ``__init__`` imports
``agent.testing.db`` -> ``db.session``, which builds the engine at import time
and refuses to import without a database URL. Locally it only worked because
``backend/.env`` supplied one. The package now binds a disposable SQLite file
before importing anything, so no ``.env`` is required.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]

BOOT_SCRIPT = """\
import os
assert 'DATABASE_URL' not in os.environ
from agent.testing.e2e_server import create_e2e_app
app = create_e2e_app()
print('booted', len(app.routes))
"""


def test_e2e_server_boots_without_a_database_url(tmp_path):
    """No .env, no DATABASE_URL — the package must still provide one."""
    env = {key: value for key, value in os.environ.items() if key != "DATABASE_URL"}
    env["VELA_E2E"] = "1"
    env["PYTHONPATH"] = str(BACKEND_DIR)

    # Run outside backend/ so `load_dotenv()` cannot find backend/.env and
    # silently supply the variable this test is asserting is absent.
    completed = subprocess.run(
        [sys.executable, "-c", BOOT_SCRIPT],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "booted" in completed.stdout

"""Vela deterministic backend testing package."""

import os
from pathlib import Path

# ``db.session`` builds the SQLAlchemy engine at import time and refuses to
# import without a DATABASE_URL, so the deterministic package has to bind one
# before importing any submodule — CI has no backend/.env, and
# ``python -m agent.testing.e2e_server`` imports this package before it can run
# its own setup. The default is the same disposable SQLite file the UI e2e
# server uses; callers that picked a database keep it (``setdefault``), and
# pytest is unaffected because ``db.session`` forces its own test database.
_UI_E2E_DB_FILE = Path(__file__).resolve().parents[2] / ".tmp" / "vela_e2e_ui.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_UI_E2E_DB_FILE.as_posix()}")
_UI_E2E_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
if os.environ.get("VELA_E2E") == "1" and _UI_E2E_DB_FILE.exists():
    # A UI e2e run always starts from an empty database.
    _UI_E2E_DB_FILE.unlink()

from agent.testing.db import (
    FIXED_DATETIME,
    FIXED_EXP_ID,
    FIXED_SYNC_MSG_1,
    FIXED_SYNC_MSG_2,
    FIXED_THREAD_ID,
    FIXED_THREAD_ID_2,
    FIXED_TIMESTAMP_MS,
    FIXED_USER_ID,
    SeededData,
    reset_db,
    seed_db,
)
from agent.testing.harness import (
    DeterministicHarness,
    FakeEmbeddings,
    deterministic_harness,
    fixed_clock,
    get_deterministic_app,
)
from agent.testing.provider import FakeProvider, ScriptedToolCall

__all__ = [
    "FIXED_DATETIME",
    "FIXED_EXP_ID",
    "FIXED_SYNC_MSG_1",
    "FIXED_SYNC_MSG_2",
    "FIXED_THREAD_ID",
    "FIXED_THREAD_ID_2",
    "FIXED_TIMESTAMP_MS",
    "FIXED_USER_ID",
    "DeterministicHarness",
    "FakeEmbeddings",
    "FakeProvider",
    "ScriptedToolCall",
    "SeededData",
    "deterministic_harness",
    "fixed_clock",
    "get_deterministic_app",
    "reset_db",
    "seed_db",
]

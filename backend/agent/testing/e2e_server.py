"""Deterministic UI e2e control channel ("control channel" server).

Boots the REAL FastAPI app (``agent.main:app``) with the deterministic test
doubles from :mod:`agent.testing` — ``FakeProvider`` for the LLM, deterministic
embeddings, frozen clock, seeded SQLite DB — and exposes a small, test-only
``/_e2e/*`` control channel so a Playwright spec can:

* replace the scripted LLM turns (``POST /_e2e/script``),
* reset the DB + script between tests (``POST /_e2e/reset``),
* wait on real server signals instead of sleeping (``GET /_e2e/state``),
* probe readiness for Playwright's ``webServer`` (``GET /_e2e/health``).

Everything is gated behind ``VELA_E2E=1``. Importing this module in a normal
process is inert; calling :func:`create_e2e_app` without the flag raises
``RuntimeError``. The ``/_e2e`` routes are registered on a dedicated
``APIRouter`` that only :func:`create_e2e_app` includes, so a normal
``agent.main`` startup never exposes them.

Run it::

    VELA_E2E=1 uv run python -m agent.testing.e2e_server --port 8123

The only fake is the LLM (plus frozen time/embeddings) — routing, SSE framing,
persistence and the agent graph all run for real.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from pydantic import BaseModel

E2E_ENV_FLAG = "VELA_E2E"
DEFAULT_PORT = 8123
HOST = "127.0.0.1"

#: Static API key shared with the client spec. Mirrors
#: ``DeterministicHarness(api_key=...)`` / ``agent.testing.harness``.
E2E_API_KEY = "test-api-key"

#: Deterministic briefings seeded for the "second screen" assertions.
E2E_BRIEFING_ID = "00000000-0000-4000-b000-000000000001"
E2E_BRIEFING_DATE = "2026-01-01"
E2E_BRIEFING_SUMMARY = "E2E seeded briefing: inbox clear, 2 meetings, radar calm."


class ScriptPayload(BaseModel):
    """Body for ``POST /_e2e/script``.

    Defined at module scope on purpose: this module uses
    ``from __future__ import annotations``, so FastAPI resolves the
    annotation by name from module globals. A locally-defined model would
    silently degrade to a query parameter.
    """

    # Each entry is a plain string or a ``{"tool_calls": [...]}`` dict —
    # exactly the shapes ``FakeProvider.add_script`` accepts.
    turns: list[Any]

_provider: Any = None
_clock_patch: Any = None
_router: Any = None


def require_e2e_env() -> None:
    """Refuse to do anything unless ``VELA_E2E=1``."""
    if os.environ.get(E2E_ENV_FLAG) != "1":
        raise RuntimeError(
            f"e2e control channel refused: set {E2E_ENV_FLAG}=1 to enable it. "
            "This module is test-only and must never run in production."
        )


def _install_provider() -> Any:
    """Install FakeProvider + deterministic embeddings into ``utils.llm``."""
    global _provider
    from agent.testing.harness import FakeEmbeddings
    from agent.testing.provider import FakeProvider
    from utils.llm import set_embeddings_provider, set_llm_provider

    if _provider is None:
        _provider = FakeProvider()
    provider = _provider
    provider.clear()
    set_llm_provider(provider)
    set_embeddings_provider(FakeEmbeddings())
    return provider


def _freeze_clock(fixed_dt: datetime) -> None:
    """Freeze ``utcnow_naive`` for the lifetime of the process.

    ``db.client`` binds the symbol at import time (``from db.models import
    utcnow_naive``), so both module attributes are patched — otherwise
    date-window queries such as ``get_briefing_history(days=14)`` would use
    wall-clock time while rows were seeded at ``FIXED_DATETIME``.
    """
    global _clock_patch
    from unittest.mock import patch

    if _clock_patch is not None:
        return
    _clock_patch = _MultiPatch(
        patch("db.models.utcnow_naive", return_value=fixed_dt),
        patch("db.client.utcnow_naive", return_value=fixed_dt),
    )
    _clock_patch.start()


class _MultiPatch:
    """Tiny helper to start/stop several ``unittest.mock.patch`` objects."""

    def __init__(self, *patchers: Any):
        self._patchers = patchers

    def start(self) -> None:
        for patcher in self._patchers:
            patcher.start()

    def stop(self) -> None:
        for patcher in reversed(self._patchers):
            patcher.stop()


def seed_e2e_db() -> Any:
    """Reset + seed the DB, including one deterministic briefing row."""
    from agent.testing.db import FIXED_DATETIME, seed_db
    from db.models import Briefing
    from db.session import get_db_session

    seeded = seed_db()
    with get_db_session() as session:
        session.add(
            Briefing(
                id=E2E_BRIEFING_ID,
                user_id=seeded.user_id,
                date=E2E_BRIEFING_DATE,
                summary_text=E2E_BRIEFING_SUMMARY,
                sections_json={"today": True, "inbox": True},
                created_at=FIXED_DATETIME,
            )
        )
    return seeded


def _list_threads() -> list[dict[str, Any]]:
    from db.models import Conversation
    from db.session import get_db_session

    with get_db_session() as session:
        rows = session.query(Conversation).order_by(Conversation.created_at).all()
        return [
            {"id": row.id, "title": row.title, "agent": row.agent, "is_pinned": row.is_pinned}
            for row in rows
        ]


def _build_router():
    """Build the test-only control-channel router (``/_e2e/*``)."""
    from fastapi import APIRouter

    router = APIRouter(prefix="/_e2e", tags=["e2e"])

    @router.get("/health")
    def e2e_health() -> dict[str, bool]:
        return {"ok": True}

    @router.post("/script")
    def e2e_script(payload: ScriptPayload) -> dict[str, Any]:
        provider = _provider
        provider.clear()
        provider.add_script(*payload.turns)
        return {"ok": True, "remaining_turns": provider.remaining_turns}

    @router.post("/reset")
    def e2e_reset() -> dict[str, Any]:
        seeded = seed_e2e_db()
        _provider.clear()
        return {
            "ok": True,
            "thread_id": seeded.thread_id,
            "thread_id_2": seeded.thread_id_2,
            "remaining_turns": _provider.remaining_turns,
        }

    @router.get("/state")
    def e2e_state() -> dict[str, Any]:
        return {
            "remaining_turns": _provider.remaining_turns,
            "calls": _provider.call_count,
            "supervisor_calls": len(_provider.supervisor_calls),
            "threads": _list_threads(),
        }

    return router


def create_e2e_app() -> Any:
    """Return the real FastAPI app wired for deterministic UI e2e runs."""
    require_e2e_env()

    # Determinism knobs that must land before ``agent.main`` is imported.
    # An empty GOOGLE_API_KEY keeps ``utils.helpers.get_title`` on its local
    # "Mock Title" path, so thread-title generation never eats a scripted turn.
    os.environ["VELA_API_KEY"] = E2E_API_KEY
    os.environ["GOOGLE_API_KEY"] = ""

    global _router
    from fastapi.middleware.cors import CORSMiddleware

    from agent.main import app
    from agent.testing.db import FIXED_DATETIME

    _install_provider()
    _freeze_clock(FIXED_DATETIME)
    seed_e2e_db()

    if _router is None:
        _router = _build_router()
        app.include_router(_router)

    # The Expo web dev server is a different origin; auth is a bearer header
    # (no cookies), so a permissive CORS policy is safe for this test server.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Vela deterministic UI e2e server")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("VELA_E2E_PORT", DEFAULT_PORT)),
    )
    parser.add_argument("--log-level", default="warning")
    args = parser.parse_args(argv)

    os.environ[E2E_ENV_FLAG] = "1"
    app = create_e2e_app()

    import uvicorn

    uvicorn.run(app, host=HOST, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    main()

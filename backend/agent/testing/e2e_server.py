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


class FixturePayload(BaseModel):
    """Body for ``POST /_e2e/fixture``.

    Defined at module scope on purpose: this module uses
    ``from __future__ import annotations``, so FastAPI resolves the
    annotation by name from module globals.
    """

    name: str

_provider: Any = None
_clock_patch: Any = None
_router: Any = None
_orig_env: dict[str, str | None] = {}


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


def _fixture_default() -> dict[str, Any]:
    """Default clean scenario: 2 threads, 1 briefing, cleared provider."""
    seeded = seed_e2e_db()
    _provider.clear()
    return {
        "threads": [seeded.thread_id, seeded.thread_id_2],
        "briefing_id": E2E_BRIEFING_ID,
    }


def _fixture_populated_threads() -> dict[str, Any]:
    """5 diverse threads with pinned/unpinned states and different agents."""
    from agent.testing.db import FIXED_DATETIME, seed_db
    from db.models import Briefing
    from db.session import get_db_session

    custom_threads = [
        {
            "id": "00000000-0000-4000-8000-000000000001",
            "title": "Daily Standup & Objectives",
            "agent": "personal assistant",
            "is_pinned": True,
            "source": "client",
            "created_at": FIXED_DATETIME,
            "updated_at": FIXED_DATETIME,
        },
        {
            "id": "00000000-0000-4000-8000-000000000002",
            "title": "Python Async Tutoring",
            "agent": "teacher",
            "is_pinned": False,
            "source": "client",
            "created_at": FIXED_DATETIME,
            "updated_at": FIXED_DATETIME,
        },
        {
            "id": "00000000-0000-4000-8000-000000000003",
            "title": "Quarterly Financial Analysis",
            "agent": "analyst",
            "is_pinned": True,
            "source": "client",
            "created_at": FIXED_DATETIME,
            "updated_at": FIXED_DATETIME,
        },
        {
            "id": "00000000-0000-4000-8000-000000000004",
            "title": "Creative Prompt Experiments",
            "agent": "prompt builder",
            "is_pinned": False,
            "source": "client",
            "created_at": FIXED_DATETIME,
            "updated_at": FIXED_DATETIME,
        },
        {
            "id": "00000000-0000-4000-8000-000000000005",
            "title": "Archived Architecture Review",
            "agent": "personal assistant",
            "is_pinned": False,
            "source": "client",
            "created_at": FIXED_DATETIME,
            "updated_at": FIXED_DATETIME,
        },
    ]

    custom_experiences = [
        {
            "id": "00000000-0000-4000-a000-000000000001",
            "conversation_id": "00000000-0000-4000-8000-000000000001",
            "user_query": "What are my priorities today?",
            "agent_response": "1. Review PR stack\n2. Sync with team at 10am.",
            "created_at": FIXED_DATETIME,
        },
        {
            "id": "00000000-0000-4000-a000-000000000002",
            "conversation_id": "00000000-0000-4000-8000-000000000002",
            "user_query": "How do event loops work?",
            "agent_response": "An event loop manages task scheduling and I/O polling.",
            "created_at": FIXED_DATETIME,
        },
    ]

    seeded = seed_db(threads=custom_threads, experiences=custom_experiences, reset=True)
    _provider.clear()

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

    return {
        "threads": [t["id"] for t in custom_threads],
        "experiences": [e["id"] for e in custom_experiences],
    }


def _fixture_briefing_history() -> dict[str, Any]:
    """5 consecutive daily briefings for testing historical briefing views."""
    from agent.testing.db import FIXED_DATETIME, seed_db
    from db.models import Briefing
    from db.session import get_db_session

    seeded = seed_db()
    _provider.clear()

    briefings = [
        ("00000000-0000-4000-b000-000000000001", "2026-01-01", "Jan 1: Year kickoff, inbox clear."),
        ("00000000-0000-4000-b000-000000000002", "2026-01-02", "Jan 2: Sprint planning in progress."),
        ("00000000-0000-4000-b000-000000000003", "2026-01-03", "Jan 3: Radar clear, 1 meeting today."),
        ("00000000-0000-4000-b000-000000000004", "2026-01-04", "Jan 4: Architecture review completed."),
        ("00000000-0000-4000-b000-000000000005", "2026-01-05", "Jan 5: Weekly wrap-up and release."),
    ]

    with get_db_session() as session:
        for b_id, b_date, b_summary in briefings:
            session.add(
                Briefing(
                    id=b_id,
                    user_id=seeded.user_id,
                    date=b_date,
                    summary_text=b_summary,
                    sections_json={"today": True, "inbox": True},
                    created_at=FIXED_DATETIME,
                )
            )

    return {
        "briefings": [{"id": b_id, "date": b_date} for b_id, b_date, _ in briefings],
    }


def _fixture_error_turn() -> dict[str, Any]:
    """Default DB state with a scripted error turn."""
    seed_e2e_db()
    _provider.clear()
    error_msg = "Deterministic simulated backend failure"
    _provider.add_script({"kind": "error", "message": error_msg})
    return {"scripted_error": error_msg}


def _fixture_delay_stream() -> dict[str, Any]:
    """Default DB state with a paced, delayed streaming turn."""
    seed_e2e_db()
    _provider.clear()
    _provider.add_script({
        "kind": "delay",
        "ms": 50,
        "chunks": ["Paced ", "streaming ", "chunk ", "delivery."],
    })
    return {"scripted_delay_ms": 50}


_FIXTURE_REGISTRY: dict[str, Any] = {
    "default": _fixture_default,
    "populated_threads": _fixture_populated_threads,
    "briefing_history": _fixture_briefing_history,
    "error_turn": _fixture_error_turn,
    "delay_stream": _fixture_delay_stream,
}


def _build_router():
    """Build the test-only control-channel router (``/_e2e/*``)."""
    from fastapi import APIRouter, HTTPException

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

    @router.post("/fixture")
    def e2e_fixture(payload: FixturePayload) -> dict[str, Any]:
        if payload.name not in _FIXTURE_REGISTRY:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown fixture '{payload.name}'. Available: {sorted(_FIXTURE_REGISTRY.keys())}",
            )
        fixture_fn = _FIXTURE_REGISTRY[payload.name]
        details = fixture_fn()
        return {
            "ok": True,
            "fixture": payload.name,
            "details": details,
            "remaining_turns": _provider.remaining_turns,
        }

    @router.post("/reset")
    def e2e_reset() -> dict[str, Any]:
        seeded = seed_e2e_db()
        _provider.clear()
        return {
            "ok": True,
            "thread_id": seeded.thread_id,
            "thread_id_2": seeded.thread_id_2,
            "remaining_turns": _provider.remaining_turns,
            "available_fixtures": sorted(_FIXTURE_REGISTRY.keys()),
        }

    @router.get("/state")
    def e2e_state() -> dict[str, Any]:
        return {
            "remaining_turns": _provider.remaining_turns,
            "calls": _provider.call_count,
            "supervisor_calls": len(_provider.supervisor_calls),
            "threads": _list_threads(),
            "available_fixtures": sorted(_FIXTURE_REGISTRY.keys()),
        }

    return router


def create_e2e_app() -> Any:
    """Return the real FastAPI app wired for deterministic UI e2e runs."""
    require_e2e_env()

    global _orig_env
    for k in ("VELA_API_KEY", "GOOGLE_API_KEY"):
        if k not in _orig_env:
            _orig_env[k] = os.environ.get(k)

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
    if app.middleware_stack is None and not any(
        getattr(m, "cls", None) == CORSMiddleware
        for m in getattr(app, "user_middleware", [])
    ):
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
    return app


def teardown_e2e_app() -> None:
    """Tear down e2e overrides: reset LLM/embeddings providers, unpatch clock, restore env."""
    global _clock_patch, _provider, _orig_env
    from utils.llm import reset_embeddings_provider, reset_llm_provider

    reset_llm_provider()
    reset_embeddings_provider()
    if _clock_patch is not None:
        _clock_patch.stop()
        _clock_patch = None
    _provider = None
    for k, v in _orig_env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    _orig_env.clear()


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

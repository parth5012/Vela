"""Replay a corpus fixture through the real app and collect an observation.

The runner is the only place that knows how a fixture's declarative
``request``/``prep``/``script`` maps onto the HTTP surface. It is shared by the
pytest suite and by ``python -m corpus.regen`` so both always exercise exactly
the same code path.

Determinism guards (no network, no real LLM, no sleeps):
* ``FakeProvider`` is installed by ``DeterministicHarness``.
* the clock is frozen by the harness.
* ``E2B_API_KEY`` is blanked while the fixture runs so ``run_python_code``
  always takes its offline mock branch, independent of a developer's ``.env``.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch

from agent.spec import validate_sse_line
from corpus.loader import THREAD_MODES, Fixture
from db.models import Conversation, Experience, SyncMessage, SystemPromptFragment
from db.session import get_db_session

#: Stable id used for every fixture that creates a fresh thread. The DB is
#: reset per fixture, so reusing one id keeps runs reproducible without
#: letting thread ids become part of the expectations.
CORPUS_NEW_THREAD_ID = "00000000-0000-4000-8000-000000000493"

SEEDED_TITLES = {
    "seeded": "Seeded Chat 1",
    "seeded_2": "Seeded Chat 2",
}

_PREP_OPS = ("set_conversation_source", "set_conversation_title", "set_dynamic_rules", "clear_dynamic_rules")


class CorpusRunError(RuntimeError):
    """Raised when a fixture cannot be replayed (bad prep op, HTTP failure...)."""


@dataclass
class ObservedRun:
    """Raw, pre-normalization observation of one fixture replay."""

    known_title: str | None
    events: list[dict[str, Any]] = field(default_factory=list)
    persisted: dict[str, Any] = field(default_factory=dict)
    prompt: str | None = None
    remaining_script_turns: int = 0


@contextmanager
def _offline_tools():
    """Force tool implementations onto their offline branches."""
    with patch.dict(os.environ, {"E2B_API_KEY": ""}, clear=False):
        yield


def resolve_thread_id(client: Any, mode: str) -> str:
    """Resolve a fixture thread mode to a concrete thread id."""
    if mode not in THREAD_MODES:
        raise CorpusRunError(f"unknown thread mode {mode!r}; expected one of {THREAD_MODES}")
    seeded = client.seeded_data
    if seeded is None:
        raise CorpusRunError("deterministic client has no seeded data")
    if mode == "seeded":
        return seeded.thread_id
    if mode == "seeded_2":
        return seeded.thread_id_2
    return CORPUS_NEW_THREAD_ID


def _conversation_title(thread_id: str) -> str | None:
    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=thread_id).first()
        return conv.title if conv is not None else None


def _apply_prep(client: Any, prep: list[dict[str, Any]]) -> None:
    for op in prep:
        kind = op.get("op")
        if kind not in _PREP_OPS:
            raise CorpusRunError(f"unknown prep op {kind!r}; expected one of {_PREP_OPS}")

        if kind in ("set_conversation_source", "set_conversation_title"):
            thread_id = resolve_thread_id(client, op.get("thread_id", "seeded"))
            with get_db_session() as session:
                conv = session.query(Conversation).filter_by(id=thread_id).first()
                if conv is None:
                    raise CorpusRunError(f"prep {kind}: thread {thread_id} does not exist")
                if kind == "set_conversation_source":
                    conv.source = op["source"]
                else:
                    conv.title = op["title"]
            continue

        with get_db_session() as session:
            event = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
            if kind == "clear_dynamic_rules":
                if event is not None:
                    session.delete(event)
            else:
                if event is None:
                    session.add(SystemPromptFragment(key="dynamic_rules", content=op["content"]))
                else:
                    event.content = op["content"]


def _stream_turn(client: Any, *, thread_id: str, message: str, agent: str) -> list[dict[str, Any]]:
    """POST /chat/message and return the validated SSE event payloads."""
    payload = {"thread_id": thread_id, "message": message, "agent": agent}
    events: list[dict[str, Any]] = []
    with client.stream("POST", "/chat/message", json=payload) as response:
        if response.status_code != 200:
            raise CorpusRunError(
                f"POST /chat/message returned {response.status_code}: {response.text[:500]}"
            )
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" not in content_type:
            raise CorpusRunError(f"expected text/event-stream, got {content_type!r}")

        for line in response.iter_lines():
            if not line or line.startswith(":"):
                continue
            event = validate_sse_line(line)
            events.append(event.model_dump(exclude_none=True))
    return events


def _collect_persisted(thread_id: str, message: str) -> dict[str, Any]:
    """Read back the graded turn plus conversation state from the database."""
    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=thread_id).first()
        if conv is None:
            raise CorpusRunError(f"conversation {thread_id} was not created")

        experiences = (
            session.query(Experience)
            .filter_by(conversation_id=thread_id)
            .order_by(Experience.created_at.asc())
            .all()
        )
        matches = [exp for exp in experiences if exp.user_query == message]
        if not matches:
            raise CorpusRunError(f"no Experience row persisted for message {message!r}")
        turn = matches[-1]

        sync_messages = session.query(SyncMessage).filter_by(conversation_id=thread_id).all()
        assistant_sync = [
            {"content": sync.content, "provider": sync.provider}
            for sync in sync_messages
            if sync.role == "assistant" and sync.content and sync.content == turn.agent_response
        ]

        return {
            "user_query": turn.user_query,
            "agent_response": turn.agent_response,
            "conversation_agent": conv.agent,
            "conversation_source": conv.source,
            "conversation_title": conv.title,
            "thread_message_count": len(experiences) * 2,
            "assistant_sync_messages": assistant_sync,
        }


def _last_chatbot_prompt(client: Any) -> str | None:
    """Return the system prompt of the most recent chatbot (non-supervisor) call."""
    from langchain_core.messages import SystemMessage

    for call in reversed(client.provider.calls):
        system = next((m for m in call["messages"] if isinstance(m, SystemMessage)), None)
        if system is not None:
            return str(system.content)
    return None


def run_fixture(client: Any, fixture: Fixture) -> ObservedRun:
    """Replay ``fixture`` against a deterministic client and observe the result."""
    provider = client.provider
    provider.clear()
    _apply_prep(client, fixture.prep)

    provider.add_script(*fixture.script)

    request = fixture.request
    thread_id = resolve_thread_id(client, request["thread_id"])
    known_title = _conversation_title(thread_id)

    with _offline_tools():
        for prior in fixture.prior_turns:
            _stream_turn(
                client,
                thread_id=thread_id,
                message=prior["message"],
                agent=prior.get("agent", request["agent"]),
            )

        events = _stream_turn(
            client,
            thread_id=thread_id,
            message=request["message"],
            agent=request["agent"],
        )

    return ObservedRun(
        known_title=known_title,
        events=events,
        persisted=_collect_persisted(thread_id, request["message"]),
        prompt=_last_chatbot_prompt(client),
        remaining_script_turns=provider.remaining_turns,
    )

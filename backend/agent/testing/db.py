"""Database seeding and reset harness for Vela deterministic tests."""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from db.models import (
    Briefing,
    CheckIn,
    Conversation,
    Experience,
    OAuthToken,
    PendingClientMailbox,
    SkillsRegistry,
    SyncMessage,
    SystemPromptFragment,
    SystemSetting,
    ToolInvocation,
    WebViewAutomationSession,
    WebViewAutomationStep,
)
from db.session import get_db_session

# Deterministic timestamps & IDs for reproducible tests
FIXED_DATETIME = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC).replace(tzinfo=None)
FIXED_TIMESTAMP_MS = 1767268800000

FIXED_THREAD_ID = "00000000-0000-4000-8000-000000000001"
FIXED_THREAD_ID_2 = "00000000-0000-4000-8000-000000000002"
FIXED_USER_ID = "user-fixed-123"
FIXED_EXP_ID = "00000000-0000-4000-a000-000000000001"
FIXED_SYNC_MSG_1 = "01JH0000000000000000000001"
FIXED_SYNC_MSG_2 = "01JH0000000000000000000002"


@dataclass
class SeededData:
    """Container holding objects and IDs inserted during DB seeding."""

    threads: list[Conversation]
    settings: list[SystemSetting]
    experiences: list[Experience]
    sync_messages: list[SyncMessage]
    fixed_datetime: datetime
    fixed_timestamp_ms: int
    thread_id: str
    thread_id_2: str
    user_id: str


def reset_db(session: Session | None = None) -> None:
    """Clear all test database tables in reverse-dependency order."""
    if session is not None:
        _do_reset(session)
    else:
        with get_db_session() as s:
            _do_reset(s)


def _do_reset(session: Session) -> None:
    """Execute deletion on all tables in safe FK order."""
    # Child tables first
    tables_to_clear = [
        SyncMessage,
        Experience,
        OAuthToken,
        ToolInvocation,
        WebViewAutomationStep,
        WebViewAutomationSession,
        CheckIn,
        Briefing,
        Conversation,
        SystemSetting,
        SystemPromptFragment,
        SkillsRegistry,
        PendingClientMailbox,
    ]
    for model in tables_to_clear:
        with suppress(Exception):
            session.execute(delete(model))
    session.flush()


def seed_db(
    session: Session | None = None,
    threads: list[dict[str, Any]] | None = None,
    settings: list[dict[str, Any]] | None = None,
    experiences: list[dict[str, Any]] | None = None,
    sync_messages: list[dict[str, Any]] | None = None,
    reset: bool = True,
) -> SeededData:
    """Seed the database with fixed, deterministic initial state.

    Args:
        session: Active SQLAlchemy session (if None, get_db_session is used).
        threads: Custom conversation dictionaries (or None for fixed defaults).
        settings: Custom setting dictionaries (or None for fixed defaults).
        experiences: Custom experience dictionaries (or None for fixed defaults).
        sync_messages: Custom sync message dictionaries (or None for fixed defaults).
        reset: Whether to wipe all existing DB data before seeding (default True).

    Returns:
        SeededData dataclass with seeded records and deterministic identifiers.
    """
    if session is not None:
        return _do_seed(session, threads, settings, experiences, sync_messages, reset)
    with get_db_session() as s:
        return _do_seed(s, threads, settings, experiences, sync_messages, reset)


def _do_seed(
    session: Session,
    threads: list[dict[str, Any]] | None,
    settings: list[dict[str, Any]] | None,
    experiences: list[dict[str, Any]] | None,
    sync_messages: list[dict[str, Any]] | None,
    reset: bool,
) -> SeededData:
    if reset:
        _do_reset(session)

    # 1. Seed Conversations (Threads)
    seeded_threads: list[Conversation] = []
    if threads is None:
        threads_data = [
            {
                "id": FIXED_THREAD_ID,
                "title": "Seeded Chat 1",
                "agent": "personal assistant",
                "is_pinned": False,
                "source": "client",
                "created_at": FIXED_DATETIME,
                "updated_at": FIXED_DATETIME,
            },
            {
                "id": FIXED_THREAD_ID_2,
                "title": "Seeded Chat 2",
                "agent": "teacher",
                "is_pinned": True,
                "source": "client",
                "created_at": FIXED_DATETIME,
                "updated_at": FIXED_DATETIME,
            },
        ]
    else:
        threads_data = threads

    for td in threads_data:
        conv = Conversation(
            id=td["id"],
            title=td.get("title", "New Chat"),
            agent=td.get("agent", "personal assistant"),
            is_pinned=td.get("is_pinned", False),
            source=td.get("source", "client"),
            active_skill=td.get("active_skill"),
            created_at=td.get("created_at", FIXED_DATETIME),
            updated_at=td.get("updated_at", FIXED_DATETIME),
        )
        session.add(conv)
        seeded_threads.append(conv)
    session.flush()

    # 2. Seed System Settings
    seeded_settings: list[SystemSetting] = []
    if settings is None:
        settings_data = [
            {"key": "user_name", "value": "Test User", "updated_at": FIXED_DATETIME},
            {"key": "user_id", "value": FIXED_USER_ID, "updated_at": FIXED_DATETIME},
            {"key": "active_persona", "value": "personal assistant", "updated_at": FIXED_DATETIME},
            {"key": "theme", "value": "dark", "updated_at": FIXED_DATETIME},
        ]
    else:
        settings_data = settings

    for sd in settings_data:
        setting = SystemSetting(
            key=sd["key"],
            value=str(sd["value"]),
            updated_at=sd.get("updated_at", FIXED_DATETIME),
        )
        session.add(setting)
        seeded_settings.append(setting)
    session.flush()

    # 3. Seed Experiences
    seeded_experiences: list[Experience] = []
    if experiences is None:
        exp_data = [
            {
                "id": FIXED_EXP_ID,
                "conversation_id": FIXED_THREAD_ID,
                "user_query": "Hello",
                "agent_response": "Hi! How can I help you today?",
                "created_at": FIXED_DATETIME,
            }
        ]
    else:
        exp_data = experiences

    for ed in exp_data:
        exp = Experience(
            id=ed["id"],
            conversation_id=ed["conversation_id"],
            user_query=ed.get("user_query", ""),
            agent_response=ed.get("agent_response", ""),
            eval_score=ed.get("eval_score"),
            eval_reason=ed.get("eval_reason"),
            consolidated=ed.get("consolidated", False),
            created_at=ed.get("created_at", FIXED_DATETIME),
        )
        session.add(exp)
        seeded_experiences.append(exp)
    session.flush()

    # 4. Seed Sync Messages
    seeded_sync_messages: list[SyncMessage] = []
    if sync_messages is None:
        sync_data = [
            {
                "id": FIXED_SYNC_MSG_1,
                "conversation_id": FIXED_THREAD_ID,
                "role": "user",
                "content": "Hello",
                "provider": "client",
                "created_at": FIXED_TIMESTAMP_MS,
            },
            {
                "id": FIXED_SYNC_MSG_2,
                "conversation_id": FIXED_THREAD_ID,
                "role": "assistant",
                "content": "Hi! How can I help you today?",
                "provider": "cloud",
                "created_at": FIXED_TIMESTAMP_MS + 1000,
            },
        ]
    else:
        sync_data = sync_messages

    for smd in sync_data:
        sm = SyncMessage(
            id=smd["id"],
            conversation_id=smd["conversation_id"],
            role=smd.get("role", "user"),
            content=smd.get("content", ""),
            provider=smd.get("provider", "client"),
            created_at=smd.get("created_at", FIXED_TIMESTAMP_MS),
        )
        session.add(sm)
        seeded_sync_messages.append(sm)
    session.flush()

    return SeededData(
        threads=seeded_threads,
        settings=seeded_settings,
        experiences=seeded_experiences,
        sync_messages=seeded_sync_messages,
        fixed_datetime=FIXED_DATETIME,
        fixed_timestamp_ms=FIXED_TIMESTAMP_MS,
        thread_id=FIXED_THREAD_ID,
        thread_id_2=FIXED_THREAD_ID_2,
        user_id=FIXED_USER_ID,
    )

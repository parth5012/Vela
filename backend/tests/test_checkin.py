"""Tests for daily check-in backend (wayfinder #115).

Covers:
- CheckIn model unique (conversation_id, date) constraint
- DBClient upsert (create + same-day replace) and history query
- POST /api/checkins upsert + mood 1-5 validation + save_user_memory side effect
- GET /api/checkins?days=14 returns entries
- GET /api/checkins/summary returns an on-demand reflection
- check-in agent registered; POST /api/tasks/run accepts agent="check-in"
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from db.models import Base
from db.client import DBClient


@pytest.fixture
def db_session():
    """In-memory SQLite database for DBClient check-in operations."""
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    tables = [
        Base.metadata.tables["conversations"],
        Base.metadata.tables["check_ins"],
    ]
    Base.metadata.create_all(bind=engine, tables=tables)

    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _conv_id():
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

def test_checkin_model_has_unique_conversation_date_constraint():
    from db.models import CheckIn

    assert "check_ins" in Base.metadata.tables
    table = Base.metadata.tables["check_ins"]
    unique_cols = [
        tuple(sorted(c.name for c in constraint.columns))
        for constraint in table.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    ]
    assert tuple(sorted(["conversation_id", "date"])) in unique_cols


# ---------------------------------------------------------------------------
# DBClient upsert + history
# ---------------------------------------------------------------------------

def test_upsert_checkin_creates_then_replaces_same_day(db_session):
    client = DBClient(db_session)
    cid = _conv_id()
    client.create_client_conversation(conversation_id=cid)
    db_session.commit()

    today = datetime.utcnow().strftime("%Y-%m-%d")
    first = client.upsert_checkin(
        conversation_id=cid, date=today, mood=4, energy=3,
        win="Shipped the feature", carrying="Deadlines",
    )
    db_session.commit()
    assert first.mood == 4
    assert first.win == "Shipped the feature"

    second = client.upsert_checkin(
        conversation_id=cid, date=today, mood=2, energy=2,
        win="Rested", carrying="Nothing much",
    )
    db_session.commit()
    assert second.id == first.id
    assert second.mood == 2
    assert second.win == "Rested"

    history = client.get_checkins(conversation_id=cid, days=14)
    assert len(history) == 1
    assert history[0].mood == 2


def test_get_checkins_respects_days_window(db_session):
    client = DBClient(db_session)
    cid = _conv_id()
    client.create_client_conversation(conversation_id=cid)
    db_session.commit()

    today = datetime.utcnow()
    client.upsert_checkin(
        conversation_id=cid, date=today.strftime("%Y-%m-%d"),
        mood=5, energy=5, win="Today win",
    )
    old_date = (today - timedelta(days=30)).strftime("%Y-%m-%d")
    client.upsert_checkin(
        conversation_id=cid, date=old_date,
        mood=1, energy=1, win="Old win",
    )
    db_session.commit()

    recent = client.get_checkins(conversation_id=cid, days=14)
    assert len(recent) == 1
    assert recent[0].win == "Today win"

    all_entries = client.get_checkins(conversation_id=cid, days=60)
    assert len(all_entries) == 2


# ---------------------------------------------------------------------------
# API endpoints (hit the real file-backed test DB like test_briefing.py)
# ---------------------------------------------------------------------------

@pytest.fixture
def api_client(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-checkin-api-key")
    from agent.main import app

    return TestClient(app)


def _memory_fake(recorded):
    """Fake save_user_memory tool recording distilled facts."""

    class FakeTool:
        def func(self, conversation_id, fact):
            recorded.append({"conversation_id": conversation_id, "fact": fact})
            return f"Successfully saved new memory: '{fact}'"

    return FakeTool()


def test_post_checkin_upserts_and_get_returns_entries(api_client, monkeypatch):
    import tools.memory

    recorded = []
    monkeypatch.setattr(tools.memory, "save_user_memory", _memory_fake(recorded))

    cid = _conv_id()
    headers = {"Authorization": "Bearer test-checkin-api-key"}
    payload = {
        "conversation_id": cid,
        "mood": 4,
        "energy": 3,
        "win": "Finished the report",
        "carrying": "Worry about tomorrow",
    }

    res = api_client.post("/api/checkins", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mood"] == 4
    assert body["conversation_id"] == cid
    assert "date" in body

    # Same-day re-check-in replaces (upsert, no duplicate)
    payload["mood"] = 2
    res = api_client.post("/api/checkins", json=payload, headers=headers)
    assert res.status_code == 200
    assert res.json()["mood"] == 2
    assert res.json()["id"] == body["id"]

    res = api_client.get(f"/api/checkins?conversation_id={cid}&days=14", headers=headers)
    assert res.status_code == 200
    entries = res.json()
    assert isinstance(entries, list)
    assert len(entries) == 1
    assert entries[0]["mood"] == 2
    assert entries[0]["win"] == "Finished the report"


def test_post_checkin_rejects_invalid_mood(api_client):
    headers = {"Authorization": "Bearer test-checkin-api-key"}
    for bad_mood in (0, 6):
        res = api_client.post(
            "/api/checkins",
            json={"conversation_id": _conv_id(), "mood": bad_mood, "energy": 3},
            headers=headers,
        )
        assert res.status_code == 422


def test_post_checkin_invokes_save_user_memory(api_client, monkeypatch):
    import tools.memory

    recorded = []
    monkeypatch.setattr(tools.memory, "save_user_memory", _memory_fake(recorded))

    cid = _conv_id()
    headers = {"Authorization": "Bearer test-checkin-api-key"}
    res = api_client.post(
        "/api/checkins",
        json={
            "conversation_id": cid,
            "mood": 5,
            "energy": 4,
            "win": "Ran first 10k",
            "carrying": "Excitement about the launch",
        },
        headers=headers,
    )
    assert res.status_code == 200
    assert len(recorded) >= 1
    facts_joined = " ".join(r["fact"] for r in recorded)
    assert "Ran first 10k" in facts_joined
    assert "Excitement about the launch" in facts_joined
    assert all(r["conversation_id"] == cid for r in recorded)


def test_post_checkin_numeric_only_skips_memory(api_client, monkeypatch):
    import tools.memory

    recorded = []
    monkeypatch.setattr(tools.memory, "save_user_memory", _memory_fake(recorded))

    headers = {"Authorization": "Bearer test-checkin-api-key"}
    res = api_client.post(
        "/api/checkins",
        json={"conversation_id": _conv_id(), "mood": 3, "energy": 3},
        headers=headers,
    )
    assert res.status_code == 200
    # Transient numeric scores are stored in Postgres only, never distilled.
    assert recorded == []


def test_get_checkins_summary(api_client, monkeypatch):
    import tools.memory

    monkeypatch.setattr(tools.memory, "save_user_memory", _memory_fake([]))

    cid = _conv_id()
    headers = {"Authorization": "Bearer test-checkin-api-key"}
    api_client.post(
        "/api/checkins",
        json={"conversation_id": cid, "mood": 4, "energy": 3, "win": "Good day"},
        headers=headers,
    )

    res = api_client.get(
        f"/api/checkins/summary?conversation_id={cid}&days=14", headers=headers
    )
    assert res.status_code == 200
    body = res.json()
    assert body["count"] >= 1
    assert "summary" in body and body["summary"]
    assert "avg_mood" in body


# ---------------------------------------------------------------------------
# check-in agent registration + tasks/run gate
# ---------------------------------------------------------------------------

def test_checkin_agent_registered():
    from agent.registry import AGENT_REGISTRY

    config = AGENT_REGISTRY.get("check-in")
    assert config is not None
    assert config.identifier == "check-in"
    assert set(config.tool_names) == {"save_user_memory", "send_status_message"}


def test_tasks_run_accepts_checkin_agent(api_client, monkeypatch):
    import agent.main as main_module

    async def fake_stream(*args, **kwargs):
        yield {
            "event": "on_chat_model_stream",
            "data": {"chunk": _Chunk("steady progress")},
        }

    class _Chunk:
        def __init__(self, content):
            self.content = content

    class FakeGraph:
        def astream_events(self, *args, **kwargs):
            return fake_stream()

    monkeypatch.setattr(main_module, "graph", FakeGraph())

    headers = {"Authorization": "Bearer test-checkin-api-key"}
    res = api_client.post(
        "/api/tasks/run",
        json={
            "task_id": "checkin-task-1",
            "title": "Evening check-in",
            "prompt": "Run the daily check-in",
            "agent": "check-in",
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "success"
    assert "steady progress" in res.json()["output"]


# ---------------------------------------------------------------------------
# CheckInSkill dialog script, JSON contract, safety fallback (wayfinder #116)
# ---------------------------------------------------------------------------

def _skill_instructions():
    import asyncio

    from skills.checkin import CheckInSkill

    return asyncio.run(CheckInSkill().execute({}))


def test_checkin_skill_registered_for_intent_classification():
    from skills import skills

    names = [s.name for s in skills]
    assert "CheckInSkill" in names


def test_checkin_skill_one_question_at_a_time_structure():
    instructions = _skill_instructions()
    lowered = instructions.lower()
    for step in ("mood", "energy", "win", "carrying"):
        assert step in lowered
    assert "one question at a time" in lowered


def test_checkin_skill_json_contract_field_names():
    import re

    instructions = _skill_instructions()
    match = re.search(r"\{[^{}]*\"mood\"[^{}]*\}", instructions)
    assert match, "skill must spell out the exact JSON completion contract"
    keys = set(re.findall(r"\"(mood|energy|win|carrying|note)\"\s*:", match.group(0)))
    assert keys == {"mood", "energy", "win", "carrying", "note"}


def test_checkin_skill_safety_fallback_no_fabricated_hotlines():
    import re

    instructions = _skill_instructions()
    lowered = instructions.lower()
    assert "stop the script" in lowered
    assert "do not save" in lowered
    # Verified-only fallback: the prompt must never contain phone-like resources
    assert not re.search(r"\+?\d[\d\s\-()]{7,}\d", instructions)

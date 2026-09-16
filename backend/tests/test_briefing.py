import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from db.models import Base
from db.client import DBClient
from tools.notify import save_briefing_watch_item
from agent.main import app


@pytest.fixture
def db_session():
    """Create in-memory SQLite database for testing DBClient operations."""
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    tables = [
        Base.metadata.tables["conversations"],
        Base.metadata.tables["oauth_tokens"],
        Base.metadata.tables["experiences"],
        Base.metadata.tables["system_prompt_fragments"],
        Base.metadata.tables["skills_registry"],
        Base.metadata.tables["system_settings"],
        Base.metadata.tables["briefings"],
    ]
    Base.metadata.create_all(bind=engine, tables=tables)

    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_briefing_config_defaults_and_update(db_session):
    client = DBClient(db_session)
    config = client.get_briefing_config()

    assert config["enabled"] is True
    assert config["time"] == "07:00"
    assert config["weekdays"] == ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    assert config["sections"] == {"today": True, "inbox": True, "radar": True}

    updated = client.update_briefing_config({
        "enabled": False,
        "time": "08:30",
        "weekdays": ["mon", "wed", "fri"],
        "sections": {"today": True, "inbox": False, "radar": True},
    })

    assert updated["enabled"] is False
    assert updated["time"] == "08:30"
    assert updated["weekdays"] == ["mon", "wed", "fri"]
    assert updated["sections"] == {"today": True, "inbox": False, "radar": True}

    config_reloaded = client.get_briefing_config()
    assert config_reloaded == updated


def test_briefing_watch_items_crud(db_session):
    client = DBClient(db_session)
    assert client.get_watch_items() == []

    item1 = client.add_watch_item(text="Track AI news", date_hint="tomorrow")
    assert item1["text"] == "Track AI news"
    assert item1["date_hint"] == "tomorrow"
    assert "id" in item1
    assert "created_at" in item1

    item2 = client.add_watch_item(text="Project milestone")
    assert item2["text"] == "Project milestone"
    assert item2["date_hint"] is None

    items = client.get_watch_items()
    assert len(items) == 2

    success = client.delete_watch_item(item1["id"])
    assert success is True

    remaining = client.get_watch_items()
    assert len(remaining) == 1
    assert remaining[0]["id"] == item2["id"]

    fail = client.delete_watch_item("non-existent-id")
    assert fail is False


def test_save_and_get_briefing_history(db_session):
    client = DBClient(db_session)

    from datetime import datetime, timedelta

    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    yesterday_str = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")

    b1 = client.save_briefing(
        date=today_str,
        summary_text="Today summary text",
        sections_json={"today": ["Task 1", "Task 2"]},
        user_id="user_123",
    )
    assert b1.id is not None
    assert b1.date == today_str
    assert b1.user_id == "user_123"

    b2 = client.save_briefing(
        date=yesterday_str,
        summary_text="Yesterday summary text",
        sections_json={"today": ["Task 0"]},
        user_id="user_123",
    )

    history = client.get_briefing_history(days=14)
    assert len(history) == 2
    assert history[0].date == today_str
    assert history[1].date == yesterday_str


def test_assistant_tool_save_briefing_watch_item(db_session, monkeypatch):
    from db.session import get_db_session
    from contextlib import contextmanager

    @contextmanager
    def mock_get_db_session():
        yield db_session

    monkeypatch.setattr("tools.notify.get_db_session", mock_get_db_session)

    result = save_briefing_watch_item.invoke({"text": "Watch product launch", "date_hint": "2026-09-01"})
    assert "Watch item saved: Watch product launch" in result

    client = DBClient(db_session)
    items = client.get_watch_items()
    assert len(items) == 1
    assert items[0]["text"] == "Watch product launch"
    assert items[0]["date_hint"] == "2026-09-01"


def test_briefing_api_endpoints(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-briefing-api-key")
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-briefing-api-key"}

    # 1. GET /api/briefing/config
    res = client.get("/api/briefing/config", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "enabled" in data
    assert "time" in data
    assert "weekdays" in data
    assert "sections" in data

    # 2. PUT /api/briefing/config
    update_payload = {
        "enabled": False,
        "time": "09:15",
        "weekdays": ["tue", "thu"],
        "sections": {"today": True, "inbox": True, "radar": False},
    }
    res = client.put("/api/briefing/config", json=update_payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["enabled"] is False
    assert data["time"] == "09:15"
    assert data["weekdays"] == ["tue", "thu"]

    # Verify GET reflects update
    res = client.get("/api/briefing/config", headers=headers)
    assert res.status_code == 200
    assert res.json()["time"] == "09:15"

    # 3. POST /api/briefings/watch
    watch_payload = {"text": "API test watch item", "date_hint": "tomorrow"}
    res = client.post("/api/briefings/watch", json=watch_payload, headers=headers)
    assert res.status_code == 200
    watch_item = res.json()
    assert watch_item["text"] == "API test watch item"
    assert watch_item["date_hint"] == "tomorrow"
    item_id = watch_item["id"]

    # 4. GET /api/briefings
    res = client.get("/api/briefings?days=14", headers=headers)
    assert res.status_code == 200
    assert isinstance(res.json(), list)

    # 5. DELETE /api/briefings/watch/{item_id}
    res = client.delete(f"/api/briefings/watch/{item_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["deleted_id"] == item_id

    # DELETE non-existent item returns 404
    res = client.delete("/api/briefings/watch/non-existent-id", headers=headers)
    assert res.status_code == 404

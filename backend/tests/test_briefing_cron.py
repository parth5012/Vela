"""Unit tests for the daily morning briefing cron job (backend/cron/briefing.py)."""

from unittest.mock import patch, MagicMock
import pytest
from db.session import get_db_session
from db.client import DBClient
from db.models import MemoryVector, SystemSetting, Briefing
from cron.briefing import _search_radar_memories, run_daily_briefing


@pytest.fixture(autouse=True)
def clean_db():
    """Clean up system_settings and briefings tables before and after each test."""
    with get_db_session() as session:
        session.query(SystemSetting).delete()
        session.query(Briefing).delete()
        session.commit()
    yield
    with get_db_session() as session:
        session.query(SystemSetting).delete()
        session.query(Briefing).delete()
        session.commit()


@patch("cron.briefing.send_push")
@patch("cron.briefing.get_llm")
@patch("cron.briefing.get_authenticated_service")
def test_run_daily_briefing_full_success(mock_get_auth_service, mock_get_llm, mock_send_push):
    """Test full flow: calendar, inbox, radar aggregation, LLM composition, push notification, record saving, and dedup marker creation."""
    mock_cal_service = MagicMock()
    mock_cal_service.events().list().execute.return_value = {
        "items": [
            {
                "summary": "Team Sync Meeting",
                "start": {"dateTime": "2026-08-30T10:00:00Z"},
                "end": {"dateTime": "2026-08-30T10:30:00Z"},
            }
        ]
    }

    mock_gmail_service = MagicMock()
    mock_gmail_service.users().messages().list().execute.return_value = {
        "messages": [{"id": "msg_123"}]
    }
    mock_gmail_service.users().messages().get().execute.return_value = {
        "id": "msg_123",
        "payload": {
            "headers": [
                {"name": "From", "value": "alice@example.com"},
                {"name": "Subject", "value": "Project Roadmap"},
            ]
        },
        "snippet": "Here is the updated roadmap.",
    }

    def side_effect_auth(api_name, conversation_id="", api_version="v1"):
        if api_name == "calendar":
            return mock_cal_service, None
        elif api_name == "gmail":
            return mock_gmail_service, None
        return None, "invalid"

    mock_get_auth_service.side_effect = side_effect_auth

    with get_db_session() as session:
        client = DBClient(session)
        client.add_watch_item("Submit weekly progress report")

    mock_llm_instance = MagicMock()
    mock_llm_instance.invoke.return_value.content = "Good morning! You have Team Sync at 10:00 AM, 1 unread email regarding Project Roadmap, and a watch item to submit report."
    mock_get_llm.return_value = mock_llm_instance

    mock_send_push.return_value = True

    res = run_daily_briefing(today_date="2026-08-30")

    assert res["status"] == "success"
    assert res["date"] == "2026-08-30"
    assert "Team Sync" in res["summary_text"]
    assert res["push_sent"] is True

    with get_db_session() as session:
        client = DBClient(session)
        briefings = client.get_briefing_history(days=30)
        assert len(briefings) == 1
        assert briefings[0].date == "2026-08-30"
        assert briefings[0].summary_text == res["summary_text"]

        marker = client.get_system_setting("briefing_sent_2026-08-30")
        assert marker is not None

    mock_send_push.assert_called_once_with(
        title="Daily Morning Briefing",
        body=res["summary_text"],
        data={"type": "briefing"},
    )


@patch("cron.briefing.send_push")
@patch("cron.briefing.get_llm")
@patch("cron.briefing.get_authenticated_service")
def test_run_daily_briefing_dedup_skip(mock_get_auth_service, mock_get_llm, mock_send_push):
    """Test that running briefing a second time on the same date skips execution."""
    with get_db_session() as session:
        client = DBClient(session)
        client.set_system_setting("briefing_sent_2026-08-30", "2026-08-30T07:00:00Z")

    res = run_daily_briefing(today_date="2026-08-30")

    assert res["status"] == "skipped"
    assert res["reason"] == "already_sent"
    mock_get_llm.assert_not_called()
    mock_send_push.assert_not_called()


@patch("cron.briefing.send_push")
@patch("cron.briefing.get_llm")
@patch("cron.briefing.get_authenticated_service")
def test_run_daily_briefing_disabled_skip(mock_get_auth_service, mock_get_llm, mock_send_push):
    """Test that briefing skips execution if briefing_enabled is set to False."""
    with get_db_session() as session:
        client = DBClient(session)
        client.set_system_setting("briefing_enabled", "false")

    res = run_daily_briefing(today_date="2026-08-30")

    assert res["status"] == "skipped"
    assert res["reason"] == "briefing_disabled"
    mock_get_llm.assert_not_called()
    mock_send_push.assert_not_called()


@patch("cron.briefing.send_push")
@patch("cron.briefing.get_llm")
@patch("cron.briefing.get_authenticated_service")
def test_run_daily_briefing_oauth_failure_fallback(mock_get_auth_service, mock_get_llm, mock_send_push):
    """Test fallback when Calendar and Gmail OAuth tokens are missing/invalid."""
    mock_get_auth_service.return_value = (None, {"status": "auth_required", "provider": "google"})

    mock_llm_instance = MagicMock()
    mock_llm_instance.invoke.return_value.content = "Good morning! No calendar or email updates available."
    mock_get_llm.return_value = mock_llm_instance
    mock_send_push.return_value = True

    res = run_daily_briefing(today_date="2026-08-30")

    assert res["status"] == "success"
    assert res["date"] == "2026-08-30"

    with get_db_session() as session:
        client = DBClient(session)
        briefings = client.get_briefing_history(days=30)
        assert len(briefings) == 1
        assert briefings[0].sections_json == {"calendar": [], "inbox": [], "radar": []}


@patch("cron.briefing.send_push")
@patch("cron.briefing.get_llm")
@patch("cron.briefing.get_authenticated_service")
def test_run_daily_briefing_llm_failure_fallback(mock_get_auth_service, mock_get_llm, mock_send_push):
    """Test raw bulleted list digest fallback when LLM fails or returns empty."""
    mock_cal_service = MagicMock()
    mock_cal_service.events().list().execute.return_value = {
        "items": [{"summary": "Standup", "start": {"dateTime": "2026-08-30T09:00:00Z"}}]
    }
    mock_get_auth_service.side_effect = lambda api, conversation_id="", api_version="v1": (
        (mock_cal_service, None) if api == "calendar" else (None, "err")
    )

    mock_get_llm.side_effect = Exception("LLM rate limit / timeout")
    mock_send_push.return_value = True

    res = run_daily_briefing(today_date="2026-08-30")

    assert res["status"] == "success"
    assert "Daily Briefing for 2026-08-30:" in res["summary_text"]
    assert "Standup" in res["summary_text"]

    with get_db_session() as session:
        client = DBClient(session)
        briefings = client.get_briefing_history(days=30)
        assert len(briefings) == 1
        assert "Standup" in briefings[0].summary_text


@patch("cron.briefing.send_push")
@patch("cron.briefing.get_llm")
@patch("cron.briefing.get_authenticated_service")
def test_run_daily_briefing_fcm_token_missing(mock_get_auth_service, mock_get_llm, mock_send_push):
    """Test that missing FCM token (send_push returning False) does not fail the briefing job."""
    mock_get_auth_service.return_value = (None, "no_auth")
    mock_llm_instance = MagicMock()
    mock_llm_instance.invoke.return_value.content = "Briefing summary."
    mock_get_llm.return_value = mock_llm_instance

    mock_send_push.return_value = False

    res = run_daily_briefing(today_date="2026-08-30")

    assert res["status"] == "success"
    assert res["push_sent"] is False

    with get_db_session() as session:
        client = DBClient(session)
        marker = client.get_system_setting("briefing_sent_2026-08-30")
        assert marker is not None


# ---------------------------------------------------------------------------
# Wayfinder T7 — Cron bounds: radar must use the pgvector index, never a
# Python full-scan. Query spies below fail loudly on unbounded .all().
# ---------------------------------------------------------------------------

class _RecordingQuery:
    """Minimal query double recording order_by/limit/all usage."""

    def __init__(self, rows):
        self._rows = rows
        self.order_by_called = False
        self.limit_n = None
        self.filter_count = 0
        self.all_calls = 0

    def filter(self, *args):
        self.filter_count += 1
        return self

    def order_by(self, *args):
        self.order_by_called = True
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def all(self):
        self.all_calls += 1
        if self.limit_n is None and len(self._rows) > 1000:
            raise MemoryError("unbounded .all() full load over OOM-scale rows")
        if self.limit_n is not None:
            return self._rows[: self.limit_n]
        return list(self._rows)


class _RecordingSession:
    """Session double recording which models are queried."""

    def __init__(self, rows):
        self._rows = rows
        self.queries = []

    def query(self, model):
        q = _RecordingQuery(self._rows)
        self.queries.append((model, q))
        return q


class _FakeRow:
    def __init__(self, content):
        self.content = content


def _fake_embeddings_module(vector):
    mock_emb = MagicMock()
    mock_emb.embed_query.return_value = vector
    return mock_emb


def test_radar_uses_indexed_order_by_limit_not_full_scan():
    """Radar with 10k mocked vectors issues ORDER BY ... LIMIT 3 (no .all())."""
    rows = [_FakeRow(f"memory {i}") for i in range(10_000)]
    session = _RecordingSession(rows)
    with patch("cron.briefing.get_embeddings",
               return_value=_fake_embeddings_module([0.01] * 512)):
        matched = _search_radar_memories(session, "watch text about mars mission")

    assert matched == ["memory 0", "memory 1", "memory 2"]
    assert len(session.queries) == 1
    model, query = session.queries[0]
    assert model is MemoryVector
    assert query.order_by_called is True
    assert query.limit_n == 3
    assert query.all_calls == 1


def test_radar_scopes_by_conversation_when_applicable():
    """Radar query filters by conversation_id when the watch item carries one."""
    rows = [_FakeRow("scoped memory")]
    session = _RecordingSession(rows)
    with patch("cron.briefing.get_embeddings",
               return_value=_fake_embeddings_module([0.02] * 512)):
        matched = _search_radar_memories(
            session, "watch text", conversation_id="conv-123"
        )

    assert matched == ["scoped memory"]
    _, query = session.queries[0]
    assert query.filter_count >= 1
    assert query.limit_n == 3


def test_radar_ilike_fallback_on_embedding_failure():
    """Embedding failure falls back to a bounded ILIKE query (limit 3)."""
    rows = [_FakeRow("matching memory")]
    session = _RecordingSession(rows)
    with patch("cron.briefing.get_embeddings",
               side_effect=RuntimeError("All embedding providers failed.")):
        matched = _search_radar_memories(session, "matching")

    assert matched == ["matching memory"]
    _, query = session.queries[0]
    assert query.order_by_called is False
    assert query.filter_count >= 1
    assert query.limit_n == 3
    assert query.all_calls == 1


@patch("cron.briefing.send_push")
@patch("cron.briefing.get_llm")
@patch("cron.briefing.get_authenticated_service")
def test_run_daily_briefing_radar_pgvector_unavailable_falls_back(
    mock_get_auth_service, mock_get_llm, mock_send_push
):
    """Embeddings OK but vector query unavailable (SQLite test env) stays green."""
    mock_get_auth_service.return_value = (None, "no_auth")
    mock_llm_instance = MagicMock()
    mock_llm_instance.invoke.return_value.content = "Briefing summary."
    mock_get_llm.return_value = mock_llm_instance
    mock_send_push.return_value = True

    with get_db_session() as session:
        client = DBClient(session)
        client.add_watch_item("Submit weekly progress report")

    with patch("cron.briefing.get_embeddings",
               return_value=_fake_embeddings_module([0.03] * 512)):
        res = run_daily_briefing(today_date="2026-08-31")

    assert res["status"] == "success"
    with get_db_session() as session:
        client = DBClient(session)
        briefings = client.get_briefing_history(days=30)
        assert len(briefings) == 1
        assert briefings[0].sections_json["radar"][0]["matched_memories"] == []

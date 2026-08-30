"""Unit tests for the daily morning briefing cron job (backend/cron/briefing.py)."""

from unittest.mock import patch, MagicMock
import pytest
from db.session import get_db_session
from db.client import DBClient
from db.models import SystemSetting, Briefing
from cron.briefing import run_daily_briefing


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

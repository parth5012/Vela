"""Tests for Calendar tools (tools/gcal.py)."""

from unittest.mock import patch, MagicMock
from tools.calendar import calendar_list_events, calendar_create_event
from utils.auth_gate import AUTH_REQUIRED


def _mock_service(service_mock):
    """Patch get_authenticated_service to return (service_mock, None)."""
    return patch(
        "tools.calendar.get_authenticated_service",
        return_value=(service_mock, None),
    )


def _mock_auth_required():
    """Patch get_authenticated_service to return auth-required tuple."""
    return patch(
        "tools.calendar.get_authenticated_service",
        return_value=(None, "Google Workspace is not connected for this conversation. "
                          "Please authenticate using the Google OAuth button in the Vela app, "
                          "then try again."),
    )


# ---------------------------------------------------------------------------
# calendar_list_events
# ---------------------------------------------------------------------------

def test_list_events_auth_required():
    """When auth gate returns AUTH_REQUIRED, the tool returns the auth message."""
    with _mock_auth_required():
        result = calendar_list_events.func(conversation_id="conv-c1")

    assert "not connected" in result
    assert "OAuth button" in result


def test_list_events_no_results():
    """When Calendar returns no events, the tool says so."""
    mock_service = MagicMock()
    mock_service.events.return_value.list.return_value.execute.return_value = {"items": []}

    with _mock_service(mock_service):
        result = calendar_list_events.func(max_results=5, conversation_id="conv-c2")

    assert "No upcoming events" in result


def test_list_events_success():
    """With valid credentials, the tool lists and formats events."""
    mock_events = {
        "items": [
            {
                "summary": "Team Standup",
                "start": {"dateTime": "2026-08-01T09:00:00+00:00"},
            },
            {
                "summary": "Lunch Meeting",
                "start": {"dateTime": "2026-08-01T12:00:00+00:00"},
            },
        ]
    }
    mock_service = MagicMock()
    mock_service.events.return_value.list.return_value.execute.return_value = mock_events

    with _mock_service(mock_service):
        result = calendar_list_events.func(max_results=10, conversation_id="conv-c3")

    assert "Upcoming Events" in result
    assert "Team Standup" in result
    assert "Lunch Meeting" in result
    assert "2026-08-01T09:00:00" in result
    mock_service.events.return_value.list.assert_called_once()


# ---------------------------------------------------------------------------
# calendar_create_event
# ---------------------------------------------------------------------------

def test_create_event_auth_required():
    """When auth gate returns AUTH_REQUIRED, the tool returns the auth message."""
    with _mock_auth_required():
        result = calendar_create_event.func(
            summary="Test",
            start_time="2026-08-01T10:00:00",
            end_time="2026-08-01T11:00:00",
            conversation_id="conv-c4",
        )

    assert "not connected" in result
    assert "OAuth button" in result


def test_create_event_success():
    """With valid credentials, the tool creates an event and returns confirmation."""
    mock_created = {
        "id": "event-123",
        "htmlLink": "https://calendar.google.com/event?eid=abc",
    }
    mock_service = MagicMock()
    mock_service.events.return_value.insert.return_value.execute.return_value = mock_created

    with _mock_service(mock_service):
        result = calendar_create_event.func(
            summary="Project Review",
            start_time="2026-08-02T14:00:00",
            end_time="2026-08-02T15:00:00",
            description="Review Q3 roadmap",
            location="Room 3B",
            conversation_id="conv-c5",
        )

    assert "Project Review" in result
    assert "created successfully" in result
    assert "calendar.google.com" in result

    call_kwargs = mock_service.events.return_value.insert.call_args[1]
    assert call_kwargs["calendarId"] == "primary"
    body = call_kwargs["body"]
    assert body["summary"] == "Project Review"
    assert body["description"] == "Review Q3 roadmap"
    assert body["location"] == "Room 3B"
    assert body["start"]["dateTime"] == "2026-08-02T14:00:00"
    assert body["end"]["dateTime"] == "2026-08-02T15:00:00"


def test_create_event_api_error():
    """When the Calendar API raises, the tool returns a friendly error."""
    mock_service = MagicMock()
    mock_service.events.return_value.insert.side_effect = Exception("API error")

    with _mock_service(mock_service):
        result = calendar_create_event.func(
            summary="Fail",
            start_time="2026-08-01T10:00:00",
            end_time="2026-08-01T11:00:00",
            conversation_id="conv-c6",
        )

    assert "Failed to create calendar event" in result
    assert "API error" in result

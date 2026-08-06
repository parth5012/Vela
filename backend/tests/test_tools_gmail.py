"""Tests for Gmail tools (tools/gmail.py)."""

from unittest.mock import patch, MagicMock
from tools.gmail import gmail_send_email, gmail_read_emails
from utils.auth_gate import AUTH_REQUIRED


def _mock_service(service_mock):
    """Return a context manager that patches get_authenticated_service to return (service_mock, None)."""
    return patch(
        "tools.gmail.get_authenticated_service",
        return_value=(service_mock, None),
    )


def _mock_auth_required():
    """Return a context manager that patches get_authenticated_service to return the auth-required tuple."""
    return patch(
        "tools.gmail.get_authenticated_service",
        return_value=(None, "Google Workspace is not connected for this conversation. "
                          "Please authenticate using the Google OAuth button in the Vela app, "
                          "then try again."),
    )


# ---------------------------------------------------------------------------
# gmail_send_email
# ---------------------------------------------------------------------------

def test_send_email_auth_required():
    """When auth gate fails, the tool returns the auth message."""
    with _mock_auth_required():
        result = gmail_send_email.func(
            to="test@example.com",
            subject="Hello",
            body="World",
            conversation_id="conv-1",
        )

    assert "not connected" in result
    assert "OAuth button" in result


def test_send_email_success():
    """With valid credentials, the tool sends via Gmail API and returns confirmation."""
    mock_service = MagicMock()
    mock_service.users.return_value.messages.return_value.send.return_value.execute.return_value = {"id": "msg-123"}

    with _mock_service(mock_service):
        result = gmail_send_email.func(
            to="alice@example.com",
            subject="Test",
            body="Message body",
            conversation_id="conv-2",
        )

    assert "Email sent successfully" in result
    assert "alice@example.com" in result
    mock_service.users.return_value.messages.return_value.send.assert_called_once()
    call_args = mock_service.users.return_value.messages.return_value.send.call_args[1]
    assert call_args["userId"] == "me"
    assert "raw" in call_args["body"]


def test_send_email_api_error():
    """When the Gmail API raises, the tool returns a friendly error."""
    mock_service = MagicMock()
    mock_service.users.return_value.messages.return_value.send.side_effect = Exception("API error")

    with _mock_service(mock_service):
        result = gmail_send_email.func(
            to="bob@example.com",
            subject="Fail",
            body="Oops",
            conversation_id="conv-3",
        )

    assert "Failed to send email" in result
    assert "API error" in result


# ---------------------------------------------------------------------------
# gmail_read_emails
# ---------------------------------------------------------------------------

def test_read_emails_auth_required():
    """When auth gate fails, the tool returns the auth message."""
    with _mock_auth_required():
        result = gmail_read_emails.func(conversation_id="conv-4")

    assert "not connected" in result
    assert "OAuth button" in result


def test_read_emails_no_results():
    """When Gmail returns no messages, the tool says so."""
    mock_service = MagicMock()
    mock_service.users.return_value.messages.return_value.list.return_value.execute.return_value = {"messages": []}

    with _mock_service(mock_service):
        result = gmail_read_emails.func(max_results=5, conversation_id="conv-5")

    assert "No emails found" in result


def test_read_emails_success():
    """With valid credentials, the tool reads and formats emails."""
    mock_list_resp = {
        "messages": [{"id": "msg-1"}, {"id": "msg-2"}],
    }
    mock_msg_1 = {
        "id": "msg-1",
        "snippet": "This is a snippet of email 1",
        "payload": {
            "headers": [
                {"name": "From", "value": "alice@example.com"},
                {"name": "Subject", "value": "Hello World"},
                {"name": "Date", "value": "Mon, 1 Jan 2024 10:00:00 +0000"},
            ]
        },
    }
    mock_msg_2 = {
        "id": "msg-2",
        "snippet": "Email 2 snippet here",
        "payload": {
            "headers": [
                {"name": "From", "value": "bob@example.com"},
                {"name": "Subject", "value": "Re: Hello World"},
                {"name": "Date", "value": "Tue, 2 Jan 2024 14:30:00 +0000"},
            ]
        },
    }

    mock_service = MagicMock()
    mock_service.users.return_value.messages.return_value.list.return_value.execute.return_value = mock_list_resp

    def get_side_effect(userId=None, id=None, format=None, metadataHeaders=None):
        get_mock = MagicMock()
        if id == "msg-1":
            get_mock.execute.return_value = mock_msg_1
        elif id == "msg-2":
            get_mock.execute.return_value = mock_msg_2
        return get_mock
    mock_service.users.return_value.messages.return_value.get.side_effect = get_side_effect

    with _mock_service(mock_service):
        result = gmail_read_emails.func(max_results=10, query="subject:hello", conversation_id="conv-6")

    assert "Recent Emails" in result
    assert "alice@example.com" in result
    assert "Hello World" in result
    assert "bob@example.com" in result
    assert "snippet of email 1" in result
    mock_service.users.return_value.messages.return_value.list.assert_called_with(
        userId="me", q="subject:hello", maxResults=10
    )


def test_read_emails_clamps_max_results():
    """max_results is clamped at 50."""
    mock_service = MagicMock()
    mock_service.users.return_value.messages.return_value.list.return_value.execute.return_value = {"messages": []}

    with _mock_service(mock_service):
        gmail_read_emails.func(max_results=100, conversation_id="conv-7")

    mock_service.users.return_value.messages.return_value.list.assert_called_with(
        userId="me", q="", maxResults=50
    )


def test_read_emails_api_error():
    """When the Gmail API raises, the tool returns a friendly error."""
    mock_service = MagicMock()
    mock_service.users.return_value.messages.return_value.list.side_effect = Exception("API error")

    with _mock_service(mock_service):
        result = gmail_read_emails.func(conversation_id="conv-8")

    assert "Failed to read emails" in result
    assert "API error" in result

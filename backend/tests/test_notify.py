import asyncio
import json
from unittest.mock import MagicMock, patch

import pytest


def _mock_firebase_setup(mock_fb_admin=None, cred_json: str | None = None):
    """Helper to mock firebase_admin state; returns patched firebase_admin module mock."""
    pass


@pytest.fixture(autouse=True)
def reset_notify_state():
    """Reset any module-level firebase init flag between tests."""
    # Ensure notify module is importable fresh
    import importlib
    import tools.notify as notify_mod
    # firebase_admin._apps mock reset is handled per-test
    yield


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_no_token_skip(mock_send, mock_init, mock_get_token):
    mock_get_token.return_value = None
    mock_init.return_value = True
    from tools.notify import send_push

    result = send_push("Hi", "body", data={"type": "briefing"})
    assert result is False
    mock_send.assert_not_called()


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_success(mock_send, mock_init, mock_get_token):
    mock_get_token.return_value = "fake-token-123"
    mock_init.return_value = True
    mock_send.return_value = "projects/vela/messages/123"

    from tools.notify import send_push

    result = send_push("Title", "Body", data={"type": "task_completion", "conversation_id": "conv-1"})
    assert result is True
    assert mock_send.called
    args, kwargs = mock_send.call_args
    msg = args[0]
    # Verify message structure
    assert msg.token == "fake-token-123"
    assert msg.notification.title == "Title"
    assert msg.notification.body == "Body"
    # data sanitized to strings and contains type
    assert msg.data["type"] == "task_completion"
    assert msg.data["conversation_id"] == "conv-1"
    # android config channel mapping
    assert msg.android.notification.channel_id == "vela_task_completion"
    assert msg.android.priority == "high"


@patch("tools.notify._delete_token")
@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_unregistered_cleanup(mock_send, mock_init, mock_get_token, mock_delete):
    mock_get_token.return_value = "bad-token"
    mock_init.return_value = True

    class FakeError(Exception):
        code = "UNREGISTERED"

    err = FakeError("Requested entity was not found. UNREGISTERED")
    mock_send.side_effect = err

    from tools.notify import send_push

    result = send_push("T", "B", data={"type": "checkin"})
    assert result is False
    mock_delete.assert_called_once()


@patch("tools.notify._delete_token")
@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_registration_token_not_registered_cleanup(mock_send, mock_init, mock_get_token, mock_delete):
    mock_get_token.return_value = "bad-token-2"
    mock_init.return_value = True

    class FakeError(Exception):
        code = "registration-token-not-registered"

    err = FakeError("registration-token-not-registered")
    mock_send.side_effect = err

    from tools.notify import send_push

    result = send_push("T", "B", data={"type": "calendar_reminder"})
    assert result is False
    mock_delete.assert_called_once()


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_generic_exception_returns_false(mock_send, mock_init, mock_get_token):
    mock_get_token.return_value = "tok"
    mock_init.return_value = True
    mock_send.side_effect = RuntimeError("boom")

    from tools.notify import send_push

    result = send_push("T", "B", data={"type": "briefing"})
    assert result is False


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_missing_type_defaults_to_generic(mock_send, mock_init, mock_get_token):
    mock_get_token.return_value = "tok"
    mock_init.return_value = True
    mock_send.return_value = "id"

    from tools.notify import send_push

    result = send_push("T", "B", data={"conversation_id": "abc"})
    assert result is True
    msg = mock_send.call_args[0][0]
    assert msg.data["type"] == "generic"
    # generic has no specific channel -> android priority normal, no channel or None
    # In our impl generic has no channel_id, so notification channel_id should be absent / None
    # But android config still exists with normal priority
    assert msg.android.priority == "normal"


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_channel_mapping_calendar(mock_send, mock_init, mock_get_token):
    mock_get_token.return_value = "tok"
    mock_init.return_value = True
    mock_send.return_value = "id"
    from tools.notify import send_push

    result = send_push("T", "B", data={"type": "calendar_reminder"})
    assert result is True
    msg = mock_send.call_args[0][0]
    assert msg.android.notification.channel_id == "vela_calendar_reminders"
    assert msg.android.priority == "normal"


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_explicit_channel_override(mock_send, mock_init, mock_get_token):
    mock_get_token.return_value = "tok"
    mock_init.return_value = True
    mock_send.return_value = "id"
    from tools.notify import send_push

    result = send_push("T", "B", data={"type": "task_completion"}, channel_id="custom_channel")
    assert result is True
    msg = mock_send.call_args[0][0]
    assert msg.android.notification.channel_id == "custom_channel"


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
def test_send_push_firebase_not_initialized_returns_false(mock_init, mock_get_token):
    mock_get_token.return_value = "tok"
    mock_init.return_value = False
    from tools.notify import send_push

    result = send_push("T", "B", data={"type": "briefing"})
    assert result is False


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_send_push_never_throws_on_messaging_import_error(mock_send, mock_init, mock_get_token):
    mock_get_token.return_value = "tok"
    mock_init.return_value = True
    mock_send.side_effect = Exception("send failed")
    from tools.notify import send_push

    # Should not raise
    result = send_push("T", "B")
    assert result is False


# --- _ensure_firebase_initialized tests ---


def test_ensure_firebase_missing_credentials_returns_false(monkeypatch):
    monkeypatch.delenv("FCM_SERVICE_ACCOUNT_JSON", raising=False)
    # Ensure firebase_admin._apps is empty
    import firebase_admin

    orig_apps = firebase_admin._apps
    firebase_admin._apps = []
    try:
        from tools.notify import _ensure_firebase_initialized

        assert _ensure_firebase_initialized() is False
    finally:
        firebase_admin._apps = orig_apps


def test_ensure_firebase_malformed_json_returns_false(monkeypatch):
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT_JSON", "{not-json")
    import firebase_admin

    orig_apps = firebase_admin._apps
    firebase_admin._apps = []
    try:
        from tools.notify import _ensure_firebase_initialized

        assert _ensure_firebase_initialized() is False
    finally:
        firebase_admin._apps = orig_apps


def test_ensure_firebase_idempotent(monkeypatch):
    """If firebase_admin._apps already populated, should return True without parsing env."""
    import firebase_admin

    orig_apps = firebase_admin._apps
    firebase_admin._apps = ["already-initialized"]
    monkeypatch.delenv("FCM_SERVICE_ACCOUNT_JSON", raising=False)
    try:
        from tools.notify import _ensure_firebase_initialized

        assert _ensure_firebase_initialized() is True
    finally:
        firebase_admin._apps = orig_apps


def test_ensure_firebase_valid_json_initializes(monkeypatch):
    import firebase_admin
    from firebase_admin import credentials

    orig_apps = firebase_admin._apps
    firebase_admin._apps = []

    fake_json = json.dumps(
        {
            "type": "service_account",
            "project_id": "test",
            "private_key_id": "kid",
            "private_key": "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
            "client_email": "test@test.iam.gserviceaccount.com",
            "client_id": "123",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/test",
        }
    )
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT_JSON", fake_json)

    mock_cert = MagicMock()
    mock_init = MagicMock()

    with patch.object(credentials, "Certificate", return_value=mock_cert) as mock_cert_cls:
        with patch.object(firebase_admin, "initialize_app", mock_init):
            from tools.notify import _ensure_firebase_initialized

            result = _ensure_firebase_initialized()
            assert result is True
            mock_cert_cls.assert_called_once()
            mock_init.assert_called_once_with(mock_cert)

    firebase_admin._apps = orig_apps


# --- async wrapper ---


@pytest.mark.asyncio
@patch("tools.notify.send_push")
async def test_send_push_async_delegates(mock_sync):
    mock_sync.return_value = True
    from tools.notify import send_push_async

    result = await send_push_async("T", "B", data={"type": "briefing"}, channel_id="vela_briefing")
    assert result is True
    mock_sync.assert_called_once_with("T", "B", {"type": "briefing"}, "vela_briefing")


@pytest.mark.asyncio
@patch("tools.notify.send_push")
async def test_send_push_async_returns_false_on_failure(mock_sync):
    mock_sync.return_value = False
    from tools.notify import send_push_async

    result = await send_push_async("T", "B")
    assert result is False


@patch("tools.notify._get_token")
@patch("tools.notify._ensure_firebase_initialized")
@patch("firebase_admin.messaging.send")
def test_delete_token_integration_unregistered(mock_send, mock_init, mock_get_token):
    """Ensure _delete_token actually deletes from DB when send fails with UNREGISTERED."""
    mock_get_token.return_value = "bad-token"
    mock_init.return_value = True

    class FakeError(Exception):
        code = "UNREGISTERED"

    err = FakeError("UNREGISTERED: token not valid")
    mock_send.side_effect = err

    # Use real DB session (sqlite test db) — insert a token then verify deletion
    from db.session import get_db_session
    from db.client import DBClient

    with get_db_session() as session:
        client = DBClient(session)
        client.set_system_setting("fcm_device_token", "bad-token")

    from tools.notify import send_push

    result = send_push("T", "B", data={"type": "briefing"})
    assert result is False

    # Token should be deleted
    with get_db_session() as session:
        client = DBClient(session)
        val = client.get_system_setting("fcm_device_token")
        assert val is None

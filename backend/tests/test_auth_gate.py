"""Tests for the Google Workspace auth gate (utils/auth_gate.py)."""

from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

from utils.auth_gate import ensure_google_auth, AUTH_REQUIRED


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def make_env_patch(env_vars: dict | None = None):
    """Patch os.getenv for the auth gate module."""
    defaults = {
        "GOOGLE_CLIENT_ID": "test-client-id",
        "GOOGLE_CLIENT_SECRET": "test-client-secret",
    }
    if env_vars is not None:
        defaults.update(env_vars)
    return patch("utils.auth_gate.os.getenv", side_effect=lambda k, d=None: defaults.get(k, d))


def make_db(tokens: dict | None = None):
    """Return a MagicMock db with optional token data."""
    db = MagicMock()
    db.get_oauth_tokens.return_value = tokens
    return db


def make_creds_mock(expired: bool = False, has_refresh: bool = True):
    """Return a MagicMock Credentials with configurable expiry."""
    creds = MagicMock()
    creds.expired = expired
    creds.refresh_token = "rt-refresh-abc" if has_refresh else None
    creds.token = "at-updated-xyz"
    creds.scopes = None
    creds.expiry = datetime.now(timezone.utc)
    return creds


# ---------------------------------------------------------------------------
# Tests — no tokens
# ---------------------------------------------------------------------------

def test_no_tokens_returns_auth_required():
    """When get_oauth_tokens returns None, the gate returns AUTH_REQUIRED."""
    db = make_db(tokens=None)

    result = ensure_google_auth("conv-123", db)

    assert result is AUTH_REQUIRED
    assert isinstance(result, dict)
    assert result["status"] == "auth_required"
    assert result["provider"] == "google"


# ---------------------------------------------------------------------------
# Tests — valid tokens
# ---------------------------------------------------------------------------

def test_valid_tokens_returns_credentials():
    """When tokens exist and are not expired, the gate returns Credentials."""
    token_data = {
        "access_token": "at-valid",
        "refresh_token": "rt-valid",
        "expiry": "2027-12-31T23:59:59Z",
    }
    db = make_db(tokens=token_data)
    dummy_creds = MagicMock()
    dummy_creds.expired = False

    with make_env_patch(), \
         patch("utils.auth_gate.Credentials", return_value=dummy_creds) as mock_creds:
        result = ensure_google_auth("conv-456", db)

    assert result is not AUTH_REQUIRED
    assert result is dummy_creds
    db.get_oauth_tokens.assert_called_once_with("global", "google")
    mock_creds.assert_called_once()


# ---------------------------------------------------------------------------
# Tests — expired tokens → refresh
# ---------------------------------------------------------------------------

def test_expired_tokens_refreshes_and_persists():
    """When tokens are expired, the gate refreshes and writes back."""
    token_data = {
        "access_token": "at-stale",
        "refresh_token": "rt-stale",
        "expiry": "2024-01-01T00:00:00Z",
    }
    db = make_db(tokens=token_data)
    refreshed_creds = make_creds_mock(expired=True, has_refresh=True)

    with make_env_patch(), \
         patch("utils.auth_gate.Credentials", return_value=refreshed_creds) as mock_creds, \
         patch("utils.auth_gate.Request") as mock_request:
        result = ensure_google_auth("conv-789", db)

    assert result is not AUTH_REQUIRED
    assert result is refreshed_creds
    # Verify refresh was called
    refreshed_creds.refresh.assert_called_once_with(mock_request.return_value)
    # Verify tokens were persisted back
    db.store_oauth_tokens.assert_called_once_with(
        "global",
        "google",
        {
            "access_token": "at-updated-xyz",
            "refresh_token": "rt-refresh-abc",
            "expiry": refreshed_creds.expiry.isoformat(),
            "scopes": mock_creds.call_args[1].get("scopes"),
        },
    )


# ---------------------------------------------------------------------------
# Tests — missing env vars
# ---------------------------------------------------------------------------

def test_missing_client_id_returns_auth_required():
    """When GOOGLE_CLIENT_ID is not set, the gate returns AUTH_REQUIRED."""
    token_data = {
        "access_token": "at-valid",
        "refresh_token": "rt-valid",
        "expiry": "2027-12-31T23:59:59Z",
    }
    db = make_db(tokens=token_data)

    with make_env_patch({"GOOGLE_CLIENT_ID": None}):
        result = ensure_google_auth("conv-999", db)

    assert result is AUTH_REQUIRED
    assert result["status"] == "auth_required"


# ---------------------------------------------------------------------------
# Tests — refresh failure falls back to auth_required
# ---------------------------------------------------------------------------

def test_refresh_exception_returns_auth_required():
    """When refresh raises, the gate returns AUTH_REQUIRED."""
    token_data = {
        "access_token": "at-stale",
        "refresh_token": "rt-stale",
        "expiry": "2024-01-01T00:00:00Z",
    }
    db = make_db(tokens=token_data)
    failing_creds = make_creds_mock(expired=True, has_refresh=True)
    failing_creds.refresh.side_effect = Exception("Network error")

    with make_env_patch(), \
         patch("utils.auth_gate.Credentials", return_value=failing_creds), \
         patch("utils.auth_gate.Request"):
        result = ensure_google_auth("conv-bad", db)

    assert result is AUTH_REQUIRED

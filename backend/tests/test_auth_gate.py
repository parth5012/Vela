"""Tests for the Google Workspace auth gate (utils/auth_gate.py)."""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from utils.auth_gate import AUTH_REQUIRED, GLOBAL_OAUTH_CONVERSATION_ID, ensure_google_auth
from utils.helpers import to_naive_utc

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
    db.get_oauth_tokens.assert_called_once_with(GLOBAL_OAUTH_CONVERSATION_ID, "google")
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
        GLOBAL_OAUTH_CONVERSATION_ID,
        "google",
        {
            "access_token": "at-updated-xyz",
            "refresh_token": "rt-refresh-abc",
            "expiry": to_naive_utc(refreshed_creds.expiry).isoformat(),
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


# ---------------------------------------------------------------------------
# Tests — storage key unification & defensive migration (finding-012)
# ---------------------------------------------------------------------------

def test_legacy_global_token_defensive_migration():
    """Defensive migration: stray rows keyed 'global' are copied to GLOBAL_OAUTH_CONVERSATION_ID."""
    token_data = {
        "access_token": "at-legacy",
        "refresh_token": "rt-legacy",
        "expiry": "2027-12-31T23:59:59Z",
    }
    db = MagicMock()
    def _mock_get_oauth_tokens(conv_id, provider):
        if conv_id == "global":
            return token_data
        return None
    db.get_oauth_tokens.side_effect = _mock_get_oauth_tokens
    dummy_creds = MagicMock(expired=False)

    with make_env_patch(), \
         patch("utils.auth_gate.Credentials", return_value=dummy_creds):
        result = ensure_google_auth("conv-new", db)

    assert result is dummy_creds
    db.store_oauth_tokens.assert_called_once_with(
        GLOBAL_OAUTH_CONVERSATION_ID, "google", token_data
    )


def test_google_drive_resolves_global_oauth_conversation_tokens():
    """Google Drive credentials lookup falls back to GLOBAL_OAUTH_CONVERSATION_ID."""
    from utils.google_drive import get_google_credentials
    token_data = {
        "access_token": "at-drive",
        "refresh_token": "rt-drive",
        "expiry": "2027-12-31T23:59:59Z",
    }
    db = MagicMock()
    def _mock_get_oauth_tokens(conv_id, provider):
        if conv_id == GLOBAL_OAUTH_CONVERSATION_ID:
            return token_data
        return None
    db.get_oauth_tokens.side_effect = _mock_get_oauth_tokens
    dummy_creds = MagicMock(expired=False)

    with make_env_patch({"GOOGLE_REFRESH_TOKEN": None}), \
         patch("utils.google_drive.Credentials", return_value=dummy_creds):
        creds = get_google_credentials("random-conv-uuid", db)

    assert creds is dummy_creds


# ---------------------------------------------------------------------------
# Tests — OAuth expiry normalized to naive UTC (finding-013)
# ---------------------------------------------------------------------------

def test_to_naive_utc_normalizes_aware_and_strings():
    """Verify to_naive_utc handles aware datetime, naive datetime, ISO strings, and None."""
    from datetime import timedelta, timezone

    from utils.helpers import to_naive_utc

    # None and empty
    assert to_naive_utc(None) is None
    assert to_naive_utc("") is None
    assert to_naive_utc("invalid-date") is None

    # Naive datetime stays naive
    naive_dt = datetime(2026, 11, 19, 12, 0, 0)
    assert to_naive_utc(naive_dt) == naive_dt
    assert to_naive_utc(naive_dt).tzinfo is None

    # Aware datetime converted to UTC and made naive
    aware_dt = datetime(2026, 11, 19, 17, 30, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    expected_utc = datetime(2026, 11, 19, 12, 0, 0)
    res_dt = to_naive_utc(aware_dt)
    assert res_dt == expected_utc
    assert res_dt.tzinfo is None

    # ISO string with aware offset (+00:00)
    iso_aware = "2026-11-19T12:00:00+00:00"
    res_iso = to_naive_utc(iso_aware)
    assert res_iso == expected_utc
    assert res_iso.tzinfo is None

    # ISO string with Z
    iso_z = "2026-11-19T12:00:00Z"
    res_z = to_naive_utc(iso_z)
    assert res_z == expected_utc
    assert res_z.tzinfo is None


def test_auth_gate_aware_expiry_credentials_expired_comparison():
    """Real Credentials object with aware expiry string does not raise TypeError on .expired."""
    from google.oauth2.credentials import Credentials

    from utils.auth_gate import ensure_google_auth

    # Aware ISO string in DB tokens (finding-013 regression case)
    token_data = {
        "access_token": "at-aware",
        "refresh_token": "rt-aware",
        "expiry": "2024-01-01T00:00:00+00:00",  # Expired, aware ISO string
    }
    db = make_db(tokens=token_data)

    with make_env_patch(), patch("utils.auth_gate.Request"):
        # Without normalization, Credentials.expired raises TypeError swallowed by except -> AUTH_REQUIRED
        # With normalization, creds.expired succeeds and triggers creds.refresh
        with patch.object(Credentials, "refresh") as mock_refresh:
            result = ensure_google_auth("conv-aware", db)
            assert result is not AUTH_REQUIRED
            mock_refresh.assert_called_once()
            assert result.expiry.tzinfo is None

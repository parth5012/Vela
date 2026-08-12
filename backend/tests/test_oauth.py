"""Tests for OAuth endpoints — Google OAuth authorize, callback, token status."""

import os
import json
import base64
import httpx
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, ANY
from agent.main import app

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

OAUTH_REDIRECT_URI = "http://localhost:8000/oauth/callback"
CLIENT_REDIRECT_URI = "vela-client://oauth/callback"
TEST_API_KEY = "vela5012"


def _set_env_vars():
    """Override env vars for tests (force set, not setdefault, to beat .env)."""
    os.environ["GOOGLE_CLIENT_ID"] = "test-client-id-123"
    os.environ["GOOGLE_CLIENT_SECRET"] = "test-client-secret-456"
    os.environ["GOOGLE_REDIRECT_URI"] = OAUTH_REDIRECT_URI
    os.environ["VELA_API_KEY"] = TEST_API_KEY


def _make_flow_mock(return_url="https://accounts.google.com/o/oauth2/auth?state=xyz"):
    """Return a (mock_flow_class, mock_flow) tuple for patching Flow."""
    mock_flow = MagicMock()
    mock_flow.authorization_url.return_value = (return_url, return_url)
    return mock_flow


def _make_google_token_response(
    access_token="at-test-abc",
    refresh_token="rt-test-xyz",
    expires_in=3600,
    id_token="eyJ.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QGdtYWlsLmNvbSIsIm5hbWUiOiJUZXN0IFVzZXIifQ.x",
):
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": str(expires_in),
        "id_token": id_token,
        "scope": "email profile openid",
        "token_type": "Bearer",
    }


def _make_userinfo_response(name="Test User", email="test@gmail.com", picture="https://pic.url"):
    return {
        "id": "1234567890",
        "name": name,
        "email": email,
        "picture": picture,
    }


# ---------------------------------------------------------------------------
# Legacy /oauth/login (Telegram flow)
# ---------------------------------------------------------------------------

@patch("agent.main.Flow")
@patch("agent.main.db")
def test_oauth_login_redirect(mock_db, mock_flow_class):
    mock_flow = MagicMock()
    mock_flow.authorization_url.return_value = ("https://accounts.google.com/o/oauth2/auth?state=123", "state123")
    mock_flow_class.from_client_config.return_value = mock_flow

    response = client.get("/oauth/login?chat_id=123", follow_redirects=False)
    assert response.status_code == 307
    assert "accounts.google.com" in response.headers["location"]

    # Regression: confidential web-client flow must not generate a PKCE
    # code_challenge that the manual token exchange can never answer.
    call_kwargs = mock_flow_class.from_client_config.call_args.kwargs
    assert call_kwargs.get("autogenerate_code_verifier") is False


# ---------------------------------------------------------------------------
# /oauth/google/authorize (mobile client flow)
# ---------------------------------------------------------------------------

@patch("agent.main.Flow")
@patch("agent.main.DBClient")
def test_google_authorize_success(mock_db_client_class, mock_flow_class):
    _set_env_vars()
    mock_flow = _make_flow_mock()
    mock_flow_class.from_client_config.return_value = mock_flow
    mock_db_client_class.return_value.create_client_conversation.return_value.id = \
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

    response = client.get(
        f"/oauth/google/authorize?redirect_uri={CLIENT_REDIRECT_URI}&api_key={TEST_API_KEY}",
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "accounts.google.com" in response.headers["location"]

    # Regression: must NOT send a PKCE code_challenge to Google, because the
    # callback performs a manual token exchange without a code_verifier.
    call_kwargs = mock_flow_class.from_client_config.call_args.kwargs
    assert call_kwargs.get("autogenerate_code_verifier") is False


@patch("agent.main.Flow")
@patch("agent.main.DBClient")
def test_google_authorize_invalid_api_key(mock_db_client_class, mock_flow_class):
    _set_env_vars()
    response = client.get(
        f"/oauth/google/authorize?redirect_uri={CLIENT_REDIRECT_URI}&api_key=wrong-key",
        follow_redirects=False,
    )
    assert response.status_code == 401
    assert "Invalid API key" in response.text


@patch("agent.main.Flow")
@patch("agent.main.DBClient")
def test_google_authorize_missing_api_key(mock_db_client_class, mock_flow_class):
    _set_env_vars()
    response = client.get(
        f"/oauth/google/authorize?redirect_uri={CLIENT_REDIRECT_URI}",
        follow_redirects=False,
    )
    assert response.status_code == 401
    assert "Invalid API key" in response.text


@patch("agent.main.Flow")
@patch("agent.main.DBClient")
def test_google_authorize_state_encoding(mock_db_client_class, mock_flow_class):
    """Verify the state parameter contains base64-encoded JSON with cid and ruri."""
    _set_env_vars()

    expected_cid = "00000000-0000-0000-0000-000000000001"
    mock_db = MagicMock()
    mock_db.create_client_conversation.return_value.id = expected_cid
    mock_db_client_class.return_value = mock_db

    mock_flow = MagicMock()
    captured_state = {}

    def _capture_authorization_url(**kwargs):
        captured_state["state"] = kwargs.get("state", "")
        return ("https://accounts.google.com/o/oauth2/auth?state=test", "test")

    mock_flow.authorization_url.side_effect = _capture_authorization_url
    mock_flow_class.from_client_config.return_value = mock_flow

    response = client.get(
        f"/oauth/google/authorize?redirect_uri={CLIENT_REDIRECT_URI}&api_key={TEST_API_KEY}",
        follow_redirects=False,
    )
    assert response.status_code == 307

    # Decode state and verify contents
    decoded = base64.urlsafe_b64decode(captured_state["state"].encode()).decode()
    state_data = json.loads(decoded)
    assert state_data["cid"] == expected_cid
    assert state_data["ruri"] == CLIENT_REDIRECT_URI


# ---------------------------------------------------------------------------
# /oauth/callback — mobile client flow (JSON state)
# ---------------------------------------------------------------------------

@patch("agent.main.httpx")
@patch("agent.main.db")
def test_callback_mobile_flow_success(mock_db, mock_httpx):
    """Mobile client OAuth callback — code exchange + user info + redirect."""
    _set_env_vars()
    conversation_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    state_data = base64.urlsafe_b64encode(
        json.dumps({"cid": conversation_id, "ruri": CLIENT_REDIRECT_URI}).encode()
    ).decode()

    # Mock token exchange response
    mock_token_resp = MagicMock()
    mock_token_resp.json.return_value = _make_google_token_response()
    mock_httpx.post.return_value = mock_token_resp

    # Mock userinfo response
    mock_user_resp = MagicMock()
    mock_user_resp.status_code = 200
    mock_user_resp.json.return_value = _make_userinfo_response()
    mock_httpx.get.return_value = mock_user_resp

    response = client.get(
        f"/oauth/callback?code=test_auth_code_123&state={state_data}",
        follow_redirects=False,
    )

    assert response.status_code == 307
    # Should redirect back to client's custom scheme
    assert CLIENT_REDIRECT_URI in response.headers["location"]
    assert "status=success" in response.headers["location"]

    # Verify token exchange was called
    mock_httpx.post.assert_called_once_with(
        "https://oauth2.googleapis.com/token",
        data={
            "code": "test_auth_code_123",
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "redirect_uri": OAUTH_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=30,
    )

    # Verify userinfo was fetched
    mock_httpx.get.assert_called_once_with(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": "Bearer at-test-abc"},
        timeout=10,
    )

    # Verify tokens were stored (with user_info merged)
    mock_db.store_oauth_tokens.assert_called_once()
    call_args = mock_db.store_oauth_tokens.call_args
    assert call_args[0][0] == "00000000-0000-0000-0000-000000000001"
    assert call_args[0][1] == "google"
    stored = call_args[0][2]
    assert stored["access_token"] == "at-test-abc"
    assert stored["refresh_token"] == "rt-test-xyz"
    assert stored["user_info"]["email"] == "test@gmail.com"
    assert stored["user_info"]["name"] == "Test User"


@patch("agent.main.httpx")
@patch("agent.main.db")
def test_callback_mobile_flow_token_exchange_failure(mock_db, mock_httpx):
    """When token exchange fails, redirect with error status."""
    _set_env_vars()
    state_data = base64.urlsafe_b64encode(
        json.dumps({"cid": "conv-123", "ruri": CLIENT_REDIRECT_URI}).encode()
    ).decode()

    mock_httpx.post.side_effect = Exception("Network error")

    response = client.get(
        f"/oauth/callback?code=bad_code&state={state_data}",
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "status=error" in response.headers["location"]


@patch("agent.main.httpx")
@patch("agent.main.db")
@patch("agent.main.logger")
def test_callback_mobile_flow_token_exchange_http_error_logs_body(
    mock_logger, mock_db, mock_httpx
):
    """HTTP 400 from Google must log the response body (e.g. invalid_grant)."""
    _set_env_vars()
    state_data = base64.urlsafe_b64encode(
        json.dumps({"cid": "conv-123", "ruri": CLIENT_REDIRECT_URI}).encode()
    ).decode()

    # Simulate Google returning 400 with an invalid_grant body.
    resp = MagicMock()
    resp.status_code = 400
    resp.text = '{"error": "invalid_grant", "error_description": "Missing code verifier"}'
    mock_httpx.post.return_value = resp
    mock_httpx.HTTPStatusError = httpx.HTTPStatusError
    mock_httpx.post.side_effect = httpx.HTTPStatusError(
        "Client error '400 Bad Request'",
        request=httpx.Request("POST", "https://oauth2.googleapis.com/token"),
        response=httpx.Response(400, text=resp.text),
    )

    response = client.get(
        f"/oauth/callback?code=bad_code&state={state_data}",
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "status=error" in response.headers["location"]

    # Error log must include the Google response body so the real reason is visible.
    mock_logger.error.assert_called()
    error_calls = [
        c for c in mock_logger.error.call_args_list if "Token exchange failed" in str(c)
    ]
    assert error_calls
    call_kwargs = error_calls[0].kwargs
    assert call_kwargs.get("status_code") == 400
    assert "invalid_grant" in call_kwargs.get("response_body", "")


# ---------------------------------------------------------------------------
# /oauth/callback — legacy Telegram flow
# ---------------------------------------------------------------------------

@patch("agent.main.httpx")
@patch("agent.main.db")
def test_callback_legacy_telegram_flow(mock_db, mock_httpx):
    """Legacy callback with plain chat_id as state should still work."""
    _set_env_vars()

    # Mock db returns a conversation_id for the Telegram chat
    mock_db.get_or_create_conversation.return_value = "conv-telegram-123"

    # Mock token exchange
    mock_token_resp = MagicMock()
    mock_token_resp.json.return_value = _make_google_token_response()
    mock_httpx.post.return_value = mock_token_resp

    # Mock userinfo
    mock_user_resp = MagicMock()
    mock_user_resp.status_code = 200
    mock_user_resp.json.return_value = _make_userinfo_response()
    mock_httpx.get.return_value = mock_user_resp

    response = client.get(
        "/oauth/callback?code=test_code&state=12345",
        follow_redirects=False,
    )

    assert response.status_code == 200
    # Legacy flow returns HTML page, not redirect
    assert "Authorization Successful" in response.text

    # Verify tokens were stored for the Telegram conversation
    mock_db.store_oauth_tokens.assert_called_once_with(
        "00000000-0000-0000-0000-000000000001", "google", ANY
    )


# ---------------------------------------------------------------------------
# /oauth/token/status (with and without conversation_id)
# ---------------------------------------------------------------------------

@patch.dict(os.environ, {"VELA_API_KEY": TEST_API_KEY})
@patch("agent.main.DBClient")
def test_token_status_not_connected(mock_db_client_class):
    """When no tokens exist, returns connected: False."""
    mock_db = MagicMock()
    mock_db.get_oauth_token.return_value = None
    mock_db_client_class.return_value = mock_db

    response = client.get(
        "/oauth/token/status",
        headers={"Authorization": f"Bearer {TEST_API_KEY}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["connected"] is False


@patch.dict(os.environ, {"VELA_API_KEY": TEST_API_KEY})
@patch("agent.main.DBClient")
def test_token_status_connected(mock_db_client_class):
    """When tokens exist, returns connected: True with user info."""
    mock_db = MagicMock()
    token_record = MagicMock()
    token_record.token = {
        "access_token": "at-abc",
        "refresh_token": "rt-xyz",
        "expiry": "2027-01-01T00:00:00+00:00",
        "id_token": "jwt-xyz",
        "user_info": {
            "name": "Test User",
            "email": "test@gmail.com",
            "picture": "https://pic.url",
        },
    }
    mock_db.get_oauth_token.return_value = token_record
    mock_db_client_class.return_value = mock_db

    response = client.get(
        "/oauth/token/status?conversation_id=conv-123",
        headers={"Authorization": f"Bearer {TEST_API_KEY}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["connected"] is True
    assert data["user"]["name"] == "Test User"
    assert data["user"]["email"] == "test@gmail.com"
    assert data["access_token"] == "at-abc"
    assert data["refresh_token"] == "rt-xyz"
    assert data["id_token"] == "jwt-xyz"


# ---------------------------------------------------------------------------
# /oauth/token — POST (mobile client direct token storage)
# ---------------------------------------------------------------------------

@patch.dict(os.environ, {"VELA_API_KEY": TEST_API_KEY})
@patch("agent.main.DBClient")
def test_store_oauth_token_endpoint(mock_db_client_class):
    """POST /oauth/token should store tokens for a conversation."""
    mock_db = MagicMock()
    mock_db_client_class.return_value = mock_db

    payload = {
        "conversation_id": "conv-store-test",
        "access_token": "at-stored",
        "refresh_token": "rt-stored",
        "expiry": "2027-06-01T00:00:00Z",
        "scopes": ["gmail.send", "calendar.events"],
    }

    response = client.post(
        "/oauth/token",
        json=payload,
        headers={"Authorization": f"Bearer {TEST_API_KEY}"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify the token was stored with correct data
    mock_db.store_oauth_token.assert_called_once()
    call_args = mock_db.store_oauth_token.call_args
    assert call_args[0][0] == "conv-store-test"
    assert call_args[0][1] == "google"
    assert call_args[0][2]["access_token"] == "at-stored"

"""Real token-refresh tests for the Google Workspace auth gate (utils/auth_gate.py).

Ticket #549 (wayfinder map #541). The pre-existing ``test_auth_gate.py``
mocks ``Credentials``, ``Request``, env, and DB, so the refresh HTTP path in
``ensure_google_auth`` is never exercised (breaking the token URI host still
leaves that suite green). This file drives the REAL code paths with only the
Google token endpoint faked at the HTTP layer, per decisions #542 (mock only
external Google HTTP, never the thing under test):

- Real ``google.oauth2.credentials.Credentials`` (expiry checks, refresh
  grant body building, ``expires_in`` parsing, error handling).
- Real ``utils.auth_gate`` helpers (``_parse_expiry``, ``_persist_tokens``).
- Real per-test isolated SQLite DB via the ``isolated_db`` fixture and the
  ``PostgresDB`` wrapper (persisted token rows asserted, not mock calls).
- Faked socket: ``httpx.MockTransport`` scripted per test, bridged into the
  ``requests`` transport that ``google.auth`` speaks through a small
  ``HTTPAdapter`` translation. ``httpx`` is already a project dependency
  (``responses`` is not, so no new dep was added).
- Failure cases (HTTP 500 / network error / invalid JSON / missing token /
  invalid grant) must fail CLOSED: return ``AUTH_REQUIRED`` and leave the
  stored tokens untouched, never a half-refreshed credential.
"""

import urllib.parse
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import requests
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from requests.adapters import HTTPAdapter
from requests.models import Response as RequestsResponse

from db.database import PostgresDB
from utils.auth_gate import (
    AUTH_REQUIRED,
    DEFAULT_SCOPES,
    GLOBAL_OAUTH_CONVERSATION_ID,
    ensure_google_auth,
)

TOKEN_URI = "https://oauth2.googleapis.com/token"
CLIENT_ID = "test-client-id-549"
CLIENT_SECRET = "test-client-secret-549"

CUSTOM_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]

# Google token response payload for a successful refresh (per OAuth 2.0
# refresh_token grant). ``expires_in`` drives Credentials expiry parsing.
REFRESH_SUCCESS_PAYLOAD = {
    "access_token": "ya29.new-access-549",
    "expires_in": 3600,
    "refresh_token": "1//new-refresh-549",
    "token_type": "Bearer",
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def google_env(monkeypatch):
    """Set the OAuth client env vars the gate reads via ``os.getenv``."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", CLIENT_SECRET)


@pytest.fixture
def google_token_endpoint(monkeypatch):
    """Route google-auth's ``Request`` at a scripted httpx MockTransport.

    The gate builds ``Request()`` from ``utils.auth_gate``; this fixture
    patches that factory to return a real ``google.auth`` ``Request``
    backed by a ``requests.Session`` whose adapter translates calls to the
    httpx transport. Every HTTP hit is recorded in ``endpoint["requests"]``;
    each test scripts ``endpoint["handler"]`` to return canned responses.
    """
    state = {"handler": None, "requests": []}

    def _transport_handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        handler = state["handler"]
        if handler is None:
            raise AssertionError("token endpoint hit but no handler scripted")
        return handler(request)

    transport = httpx.MockTransport(_transport_handler)

    class _HttpxAdapter(HTTPAdapter):
        """Minimal requests->httpx bridge so google-auth talks to MockTransport."""

        def send(self, prepared, **kwargs):
            httpx_request = httpx.Request(
                prepared.method or "GET",
                prepared.url or "",
                content=prepared.body,
                headers=dict(prepared.headers),
            )
            try:
                httpx_response = transport.handle_request(httpx_request)
            except httpx.HTTPError as exc:
                # Mimic a transport failure the way requests/mesh would see it;
                # google-auth's Request wraps RequestException as TransportError.
                raise requests.exceptions.ConnectionError(str(exc)) from exc
            response = RequestsResponse()
            response.status_code = httpx_response.status_code
            response._content = httpx_response.content
            response.headers = dict(httpx_response.headers)
            response.url = str(httpx_request.url)
            response.request = prepared
            return response

    session = requests.Session()
    session.mount("https://", _HttpxAdapter())
    session.mount("http://", _HttpxAdapter())

    def _request_factory():
        return GoogleRequest(session)

    monkeypatch.setattr("utils.auth_gate.Request", _request_factory)
    return state


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utcnow_naive() -> datetime:
    """Project timestamp rule (db.models): naive UTC, never aware."""
    return datetime.now(UTC).replace(tzinfo=None)


def _stale_expiry() -> str:
    return (_utcnow_naive() - timedelta(hours=1)).isoformat()


def _fresh_expiry() -> str:
    return (_utcnow_naive() + timedelta(days=1)).isoformat()


def _stale_tokens(**overrides) -> dict:
    tokens = {
        "access_token": "at-stale",
        "refresh_token": "rt-stale",
        "expiry": _stale_expiry(),
        "scopes": list(CUSTOM_SCOPES),
    }
    tokens.update(overrides)
    return tokens


def _store_tokens(token_data: dict) -> None:
    db = PostgresDB()
    assert db.store_oauth_tokens(GLOBAL_OAUTH_CONVERSATION_ID, "google", token_data) is True


def _read_tokens() -> dict | None:
    return PostgresDB().get_oauth_tokens(GLOBAL_OAUTH_CONVERSATION_ID, "google")


def _form(request: httpx.Request) -> dict:
    return urllib.parse.parse_qs(request.content.decode("utf-8"))


def _json_handler(payload: dict, status: int = 200):
    def _handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=payload)

    return _handle


def _assert_fail_closed(result, stored_tokens: dict, endpoint, max_requests: int | None = None):
    """Fail-closed contract: AUTH_REQUIRED sentinel and the row is untouched."""
    assert result is AUTH_REQUIRED
    assert result == {"status": "auth_required", "provider": "google"}
    assert _read_tokens() == stored_tokens
    if max_requests is not None:
        assert len(endpoint["requests"]) <= max_requests


# ---------------------------------------------------------------------------
# Refresh success — real Credentials, real persistence
# ---------------------------------------------------------------------------


def test_refresh_success_fetches_and_persists_new_tokens(
    google_env, google_token_endpoint, isolated_db
):
    """Expired tokens trigger a real refresh grant and the new row."""
    seeded = _stale_tokens()
    _store_tokens(seeded)
    google_token_endpoint["handler"] = _json_handler(REFRESH_SUCCESS_PAYLOAD)

    result = ensure_google_auth("conv-refresh-ok", PostgresDB())

    # Real Credentials object, not a mock: the token came from token endpoint.
    assert isinstance(result, Credentials)
    assert result.token == "ya29.new-access-549"
    assert result.refresh_token == "1//new-refresh-549"

    # Exactly one POST to the token URI with a proper refresh grant body.
    assert len(google_token_endpoint["requests"]) == 1
    (call,) = google_token_endpoint["requests"]
    assert call.method == "POST"
    assert str(call.url) == TOKEN_URI
    body = _form(call)
    assert body["grant_type"] == ["refresh_token"]
    assert body["refresh_token"] == ["rt-stale"]
    assert body["client_id"] == [CLIENT_ID]
    assert body["client_secret"] == [CLIENT_SECRET]

    # Persisted row holds the new tokens with parsed expiry (~now + 3600s).
    row = _read_tokens()
    assert row is not None
    assert row["access_token"] == "ya29.new-access-549"
    assert row["refresh_token"] == "1//new-refresh-549"
    remaining = datetime.fromisoformat(row["expiry"]) - _utcnow_naive()
    assert timedelta(seconds=3500) < remaining <= timedelta(seconds=3660)
    assert row["scopes"] == CUSTOM_SCOPES


def test_refresh_keeps_existing_refresh_token_when_response_omits_it(
    google_env, google_token_endpoint, isolated_db
):
    """Google may omit refresh_token on success; the old one must persist."""
    _store_tokens(_stale_tokens())
    payload = {k: v for k, v in REFRESH_SUCCESS_PAYLOAD.items() if k != "refresh_token"}
    google_token_endpoint["handler"] = _json_handler(payload)

    result = ensure_google_auth("conv-refresh-keep", PostgresDB())

    assert isinstance(result, Credentials)
    assert result.token == "ya29.new-access-549"
    assert result.refresh_token == "rt-stale"
    row = _read_tokens()
    assert row["access_token"] == "ya29.new-access-549"
    assert row["refresh_token"] == "rt-stale"


def test_refresh_uses_stored_scopes_and_persists_them(
    google_env, google_token_endpoint, isolated_db
):
    """Stored scopes ride the grant body and survive the persistence round."""
    seeded = _stale_tokens()
    _store_tokens(seeded)
    google_token_endpoint["handler"] = _json_handler(REFRESH_SUCCESS_PAYLOAD)

    ensure_google_auth("conv-scopes", PostgresDB())

    (call,) = google_token_endpoint["requests"]
    body = _form(call)
    assert body["scope"] == [" ".join(CUSTOM_SCOPES)]
    assert _read_tokens()["scopes"] == CUSTOM_SCOPES


def test_refresh_defaults_to_default_scopes_when_none_stored(
    google_env, google_token_endpoint, isolated_db
):
    """Tokens saved without scopes (legacy rows) refresh with default scopes."""
    seeded = _stale_tokens()
    del seeded["scopes"]
    _store_tokens(seeded)
    google_token_endpoint["handler"] = _json_handler(REFRESH_SUCCESS_PAYLOAD)

    result = ensure_google_auth("conv-default-scopes", PostgresDB())

    assert isinstance(result, Credentials)
    (call,) = google_token_endpoint["requests"]
    body = _form(call)
    assert body["scope"] == [" ".join(DEFAULT_SCOPES)]
    assert _read_tokens()["scopes"] == DEFAULT_SCOPES


def test_second_call_after_refresh_reuses_persisted_tokens(
    google_env, google_token_endpoint, isolated_db
):
    """Persisted expiry parses on re-read: no second refresh, same token."""
    _store_tokens(_stale_tokens())
    google_token_endpoint["handler"] = _json_handler(REFRESH_SUCCESS_PAYLOAD)
    db = PostgresDB()

    first = ensure_google_auth("conv-reuse", db)
    second = ensure_google_auth("conv-reuse", db)

    assert isinstance(first, Credentials)
    assert isinstance(second, Credentials)
    assert second.token == "ya29.new-access-549"
    # The refreshed row was still fresh, so no second HTTP call was made.
    assert len(google_token_endpoint["requests"]) == 1


# ---------------------------------------------------------------------------
# No refresh needed / no tokens
# ---------------------------------------------------------------------------


def test_valid_token_skips_refresh_and_makes_no_http_call(
    google_env, google_token_endpoint, isolated_db
):
    """Unexpired tokens return real Credentials without touching the endpoint."""
    seeded = _stale_tokens(expiry=_fresh_expiry(), access_token="at-valid")
    _store_tokens(seeded)
    # Would fail closed if a refresh were wrongly triggered.
    google_token_endpoint["handler"] = _json_handler(
        {"error": "server_error", "error_description": "must not be called"}, status=500
    )

    result = ensure_google_auth("conv-valid", PostgresDB())

    assert isinstance(result, Credentials)
    assert result.token == "at-valid"
    assert google_token_endpoint["requests"] == []
    assert _read_tokens() == seeded


def test_no_stored_tokens_fails_closed_without_http(
    google_env, google_token_endpoint, isolated_db
):
    """Empty isolated DB: AUTH_REQUIRED and the endpoint is never hit."""
    google_token_endpoint["handler"] = _json_handler(REFRESH_SUCCESS_PAYLOAD)

    result = ensure_google_auth("conv-empty", PostgresDB())

    assert result is AUTH_REQUIRED
    assert _read_tokens() is None
    assert google_token_endpoint["requests"] == []


# ---------------------------------------------------------------------------
# Failure fallback — fail closed, stored row untouched
# ---------------------------------------------------------------------------


def test_refresh_http_500_fails_closed_and_leaves_stored_tokens(
    google_env, google_token_endpoint, isolated_db
):
    """Retryable server error exhausts retries, then AUTH_REQUIRED (no bypass)."""
    seeded = _stale_tokens()
    _store_tokens(seeded)
    google_token_endpoint["handler"] = _json_handler(
        {"error": "server_error", "error_description": "backend exploded"}, status=500
    )

    result = ensure_google_auth("conv-500", PostgresDB())

    _assert_fail_closed(result, seeded, google_token_endpoint)
    # 500 is in google-auth's retryable set: at least one retry happened
    # (default ceiling is 3 attempts) before failing closed.
    assert len(google_token_endpoint["requests"]) >= 2


def test_refresh_network_error_fails_closed(
    google_env, google_token_endpoint, isolated_db
):
    """A dead network is a TransportError, never a usable credential."""
    seeded = _stale_tokens()
    _store_tokens(seeded)

    def _unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused", request=request)

    google_token_endpoint["handler"] = _unreachable

    result = ensure_google_auth("conv-net", PostgresDB())

    _assert_fail_closed(result, seeded, google_token_endpoint)


def test_refresh_non_json_success_body_fails_closed(
    google_env, google_token_endpoint, isolated_db
):
    """A 200 with a non-JSON body must not mint credentials."""
    seeded = _stale_tokens()
    _store_tokens(seeded)
    google_token_endpoint["handler"] = lambda request: httpx.Response(200, text="not json at all")

    result = ensure_google_auth("conv-badjson", PostgresDB())

    # Status was 200, so no retry: exactly one hit, then fail closed.
    _assert_fail_closed(result, seeded, google_token_endpoint, max_requests=1)
    assert len(google_token_endpoint["requests"]) == 1


def test_refresh_missing_access_token_fails_closed(
    google_env, google_token_endpoint, isolated_db
):
    """Valid JSON without access_token is a refresh error, not a credential."""
    seeded = _stale_tokens()
    _store_tokens(seeded)
    google_token_endpoint["handler"] = _json_handler(
        {"token_type": "Bearer", "expires_in": 3600}
    )

    result = ensure_google_auth("conv-notoken", PostgresDB())

    _assert_fail_closed(result, seeded, google_token_endpoint, max_requests=1)


def test_refresh_invalid_grant_fails_closed_without_retry(
    google_env, google_token_endpoint, isolated_db
):
    """Revoked refresh token (invalid_grant) is non-retryable: fail closed."""
    seeded = _stale_tokens()
    _store_tokens(seeded)
    google_token_endpoint["handler"] = _json_handler(
        {"error": "invalid_grant", "error_description": "Token has been revoked."},
        status=400,
    )

    result = ensure_google_auth("conv-revoked", PostgresDB())

    _assert_fail_closed(result, seeded, google_token_endpoint, max_requests=1)
    assert len(google_token_endpoint["requests"]) == 1

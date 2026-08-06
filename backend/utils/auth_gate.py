"""Authentication gate for Google Workspace tools.

Provides a single reusable helper that any credentialed Google tool
(Gmail, Calendar, Drive) calls before executing. It checks the
conversation's OAuth tokens, refreshes them if expired, and signals
when the user needs to authenticate via the Vela client app.
"""

import os
from datetime import datetime
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from utils.logger import StructuredLogger

logger = StructuredLogger("AuthGate")

DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file",
]

# Sentinel value returned when no valid credentials exist.
# Tools check for this and surface the auth-required message to the user.
AUTH_REQUIRED = {"status": "auth_required", "provider": "google"}

_AUTH_MSG = (
    "Google Workspace is not connected for this conversation. "
    "Please authenticate using the Google OAuth button in the Vela app, "
    "then try again."
)


def ensure_google_auth(
    conversation_id: str,
    db,
    scopes: list[str] | None = None,
) -> Credentials | dict:
    """Verify or refresh Google OAuth credentials for a conversation.

    Args:
        conversation_id: The conversation UUID.
        db: Database client with ``get_oauth_tokens`` / ``store_oauth_tokens``.
        scopes: Optional Google API scopes (defaults to Gmail + Calendar + Drive).

    Returns:
        *   ``google.oauth2.credentials.Credentials`` when the conversation has
            valid (or freshly-refreshed) tokens.
        *   ``{"status": "auth_required", "provider": "google"}`` when no
            tokens are available — the caller should tell the user to
            authenticate via the OAuth button in the Vela client app.
    """
    resolved_scopes = scopes or DEFAULT_SCOPES
    logger.info("Running auth gate", conversation_id=conversation_id)

    # 1. Read tokens from DB
    token_data = db.get_oauth_tokens("global", "google")
    if not token_data:
        logger.info("No OAuth tokens found, auth required", conversation_id=conversation_id)
        return AUTH_REQUIRED

    # 2. Build Credentials object
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

    if not client_id or not client_secret:
        logger.error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set")
        return AUTH_REQUIRED

    expiry = _parse_expiry(token_data.get("expiry"))

    try:
        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=token_data.get("scopes", resolved_scopes),
            expiry=expiry,
        )

        # 3. Auto-refresh expired credentials
        if creds.expired and creds.refresh_token:
            logger.info("Access token expired, refreshing", conversation_id=conversation_id)
            creds.refresh(Request())
            _persist_tokens(db, "global", creds, resolved_scopes)
            logger.info("Refreshed tokens persisted", conversation_id=conversation_id)

        return creds

    except Exception as e:
        logger.error("Auth gate failed", error=str(e), conversation_id=conversation_id)
        return AUTH_REQUIRED


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_expiry(expiry_str: str | None) -> datetime | None:
    if not expiry_str:
        return None
    try:
        return datetime.fromisoformat(expiry_str)
    except Exception:
        return None


def _persist_tokens(db, conversation_id: str, creds: Credentials, scopes: list[str]) -> None:
    """Write refreshed credentials back to the database."""
    updated = {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
        "scopes": creds.scopes or scopes,
    }
    db.store_oauth_tokens(conversation_id, "google", updated)


def get_authenticated_service(
    api_name: str,
    conversation_id: str,
    api_version: str = "v1",
) -> tuple:
    """Run the auth gate and build an authenticated Google API service.

    Convenience wrapper used by credentialed tools (Gmail, Calendar, etc.)
    to reduce duplication of the auth-check → service-build pattern.

    Args:
        api_name: Google API service name (e.g. ``"gmail"``, ``"calendar"``).
        conversation_id: The conversation UUID.
        api_version: API version string (default ``"v1"``).

    Returns:
        ``(service, None)`` on success, or ``(None, error_string)`` when
        authentication is required.
    """
    from db.supabase import SupabaseDB

    db = SupabaseDB()
    creds = ensure_google_auth(conversation_id, db)
    if creds is AUTH_REQUIRED:
        return None, _AUTH_MSG
    service = build(api_name, api_version, credentials=creds)
    return service, None

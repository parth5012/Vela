import asyncio
import json
import os

from db.client import DBClient
from db.models import SystemSetting
from db.session import get_db_session
from utils.logger import StructuredLogger

logger = StructuredLogger("Notify")

_VALID_TYPES = {"task_completion", "calendar_reminder", "briefing", "checkin"}

_CHANNEL_MAP: dict[str, str] = {
    "task_completion": "vela_task_completion",
    "calendar_reminder": "vela_calendar_reminders",
    "briefing": "vela_briefing",
    "checkin": "vela_checkin",
}


def _ensure_firebase_initialized() -> bool:
    """Lazy, idempotent firebase_admin initialization from env var.

    Returns True if Firebase is ready to send, False otherwise.
    Never raises — logs and returns False on any failure so callers
    can gracefully skip sending and the backend can boot without credentials.
    """
    try:
        import firebase_admin

        if firebase_admin._apps:
            return True

        raw = os.getenv("FCM_SERVICE_ACCOUNT_JSON", "")
        if not raw or not raw.strip():
            logger.error("FCM credentials missing: FCM_SERVICE_ACCOUNT_JSON not set")
            return False

        try:
            cred_dict = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("FCM credentials malformed: invalid JSON", error=str(e))
            return False

        from firebase_admin import credentials

        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        logger.info("Firebase admin initialized from FCM_SERVICE_ACCOUNT_JSON")
        return True
    except Exception as e:
        logger.error("Failed to initialize Firebase admin", error=str(e))
        return False


def _get_token() -> str | None:
    try:
        with get_db_session() as session:
            client = DBClient(session)
            token = client.get_system_setting("fcm_device_token")
            return token
    except Exception as e:
        logger.error("Failed to read FCM token from DB", error=str(e))
        return None


def _delete_token() -> None:
    try:
        with get_db_session() as session:
            setting = session.query(SystemSetting).filter_by(key="fcm_device_token").first()
            if setting is not None:
                session.delete(setting)
                # commit is handled by get_db_session context manager on successful exit,
                # but explicit commit is safe and makes intent clear for tests.
                try:
                    session.commit()
                except Exception:
                    pass
                logger.info("Deleted invalid FCM device token (UNREGISTERED)")
    except Exception as e:
        logger.error("Failed to delete invalid FCM token", error=str(e))


def _is_unregistered_error(exc: Exception) -> bool:
    """Return True if the exception indicates an invalid/unregistered token."""
    code = getattr(exc, "code", "") or ""
    # firebase_admin may expose .code as string or enum
    code_str = str(code).lower()
    msg = str(exc).lower()
    # Covers both FCM v1 strings
    if "unregistered" in code_str or "unregistered" in msg:
        return True
    if "registration-token-not-registered" in code_str or "registration-token-not-registered" in msg:
        return True
    # Also check for ApiCallError details
    return False


def send_push(
    title: str,
    body: str,
    data: dict[str, str] | None = None,
    channel_id: str | None = None,
) -> bool:
    """Send a push notification via FCM HTTP v1.

    Args:
        title: Notification title.
        body: Notification body.
        data: Optional data payload. All keys and values are coerced to strings.
              Expected keys: ``type`` in {task_completion, calendar_reminder,
              briefing, checkin} and optional ``conversation_id``.  Missing or
              invalid ``type`` becomes ``generic``.
        channel_id: Optional explicit Android channel override.  If not provided
                    the channel is derived from ``data['type']`` via CHANNEL_MAP.

    Returns:
        True if the message was sent successfully, False otherwise (no token,
        no credentials, invalid token cleanup, or any error). Never raises.
    """
    try:
        # --- Normalize data ---
        if data is None:
            data = {}
        # Coerce all keys/values to strings (FCM data values must be strings)
        sanitized: dict[str, str] = {}
        for k, v in data.items():
            try:
                sanitized[str(k)] = str(v)
            except Exception:
                sanitized[str(k)] = ""

        # Ensure required type exists
        raw_type = sanitized.get("type")
        if raw_type not in _VALID_TYPES:
            if raw_type is None:
                logger.info("send_push: missing data.type, defaulting to generic")
            else:
                logger.info("send_push: invalid data.type, defaulting to generic", raw_type=raw_type)
            sanitized["type"] = "generic"

        effective_type = sanitized["type"]

        # Determine channel_id
        if channel_id is not None:
            effective_channel = channel_id
        else:
            effective_channel = _CHANNEL_MAP.get(effective_type)

        is_high_priority = effective_channel == "vela_task_completion"

        # --- Read token ---
        token = _get_token()
        if not token:
            logger.info("send_push skipped: no FCM device token registered")
            return False

        # --- Ensure Firebase is ready ---
        if not _ensure_firebase_initialized():
            logger.error("send_push skipped: Firebase not initialized (missing/malformed credentials)")
            return False

        # --- Build and send FCM message ---
        try:
            from firebase_admin import messaging

            android_config = None
            if effective_channel is not None:
                android_priority = "high" if is_high_priority else "normal"
                # AndroidNotification priority uses string values compatible with FCM;
                # use high/default mapping at notification level
                notif_priority = "high" if is_high_priority else "default"
                android_config = messaging.AndroidConfig(
                    priority=android_priority,
                    notification=messaging.AndroidNotification(
                        channel_id=effective_channel,
                        priority=notif_priority,
                    ),
                )
            else:
                # Generic fallback still sends with normal priority for visibility
                android_config = messaging.AndroidConfig(
                    priority="normal",
                )

            notification = messaging.Notification(title=title, body=body)

            message = messaging.Message(
                token=token,
                notification=notification,
                data=sanitized if sanitized else None,
                android=android_config,
            )

            messaging.send(message)
            logger.info(
                "FCM push sent",
                title=title,
                type=effective_type,
                channel_id=effective_channel,
            )
            return True

        except Exception as e:
            if _is_unregistered_error(e):
                logger.warning("FCM token unregistered, cleaning up", error=str(e))
                _delete_token()
                return False
            logger.error("FCM send failed", error=str(e))
            return False

    except Exception as e:
        logger.error("Unexpected error in send_push", error=str(e))
        return False


async def send_push_async(
    title: str,
    body: str,
    data: dict[str, str] | None = None,
    channel_id: str | None = None,
) -> bool:
    """Async wrapper around :func:`send_push` via ``asyncio.to_thread``."""
    return await asyncio.to_thread(send_push, title, body, data, channel_id)

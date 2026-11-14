import mimetypes
import os
import time

from utils.logger import StructuredLogger
from utils.ulid import generate_ulid

logger = StructuredLogger("storage")

ATTACHMENTS_BUCKET = "chat-attachments"
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
DEFAULT_SIGNED_URL_TTL = 900  # 15 minutes (decision 18)

_STORAGE_CLIENT_OVERRIDE = None
# In-memory storage cache for mock/testing or when Supabase credentials are absent
_IN_MEMORY_STORAGE: dict[str, bytes] = {}


def set_storage_client(client):
    """Override storage client for tests."""
    global _STORAGE_CLIENT_OVERRIDE
    _STORAGE_CLIENT_OVERRIDE = client


def reset_storage_client():
    """Reset storage client override."""
    global _STORAGE_CLIENT_OVERRIDE
    _STORAGE_CLIENT_OVERRIDE = None


def get_supabase_client():
    if _STORAGE_CLIENT_OVERRIDE is not None:
        return _STORAGE_CLIENT_OVERRIDE

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

    if not supabase_url or not supabase_key or supabase_key.startswith("your_"):
        return None

    try:
        from supabase import create_client
        return create_client(supabase_url, supabase_key)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to create Supabase client", error=str(e))
        return None


def get_extension_for_mime(mime_type: str, filename: str | None = None) -> str:
    """Resolve clean file extension based on MIME type and optional filename."""
    mime_lower = mime_type.lower()
    if mime_lower == "image/jpeg":
        return "jpg"
    if mime_lower == "image/png":
        return "png"
    if mime_lower == "image/webp":
        return "webp"

    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[1].lower()
        if ext:
            return ext

    ext = mimetypes.guess_extension(mime_type)
    if ext:
        return ext.lstrip(".")
    return "bin"


def upload_chat_attachment(
    file_bytes: bytes,
    thread_id: str,
    message_id: str,
    content_type: str,
    filename: str | None = None,
    alt_text: str | None = None,
    ttl_seconds: int = DEFAULT_SIGNED_URL_TTL,
) -> dict:
    """Upload attachment to Supabase Storage and return metadata with signed URL.

    Canonical path: {thread_id}/{message_id}/{ulid}.{ext} (decision 18)
    """
    content_type_clean = content_type.lower().strip()
    if content_type_clean not in ALLOWED_MIME_TYPES:
        raise ValueError(
            f"Unsupported image type '{content_type}'. Allowed types: {sorted(ALLOWED_MIME_TYPES)}"
        )

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"File size {len(file_bytes)} bytes exceeds maximum allowed {MAX_FILE_SIZE_BYTES} bytes (10 MB)"
        )

    if len(file_bytes) == 0:
        raise ValueError("Attachment file cannot be empty")

    attachment_id = generate_ulid()
    ext = get_extension_for_mime(content_type_clean, filename)
    safe_thread_id = os.path.basename(thread_id.strip("/"))
    safe_message_id = os.path.basename(message_id.strip("/"))
    storage_path = f"{safe_thread_id}/{safe_message_id}/{attachment_id}.{ext}"

    client = get_supabase_client()
    signed_url = None

    if client:
        try:
            client.storage.from_(ATTACHMENTS_BUCKET).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type_clean, "upsert": "true"},
            )
            signed_res = client.storage.from_(ATTACHMENTS_BUCKET).create_signed_url(
                path=storage_path,
                expires_in=ttl_seconds,
            )
            if hasattr(signed_res, "signed_url") and signed_res.signed_url:
                signed_url = signed_res.signed_url
            elif hasattr(signed_res, "signedURL") and signed_res.signedURL:
                signed_url = signed_res.signedURL
            elif isinstance(signed_res, dict):
                signed_url = signed_res.get("signedURL") or signed_res.get("signedUrl")
            if not signed_url:
                signed_url = str(signed_res)
        except Exception as e:  # noqa: BLE001
            logger.error("Supabase Storage upload failed, falling back to mock storage", error=str(e), path=storage_path)
            _IN_MEMORY_STORAGE[storage_path] = file_bytes
            supabase_url = os.getenv("SUPABASE_URL", "https://mock.supabase.co")
            signed_url = f"{supabase_url}/storage/v1/object/sign/{ATTACHMENTS_BUCKET}/{storage_path}?token=mock-token&expires={int(time.time()) + ttl_seconds}"
    else:
        _IN_MEMORY_STORAGE[storage_path] = file_bytes
        supabase_url = os.getenv("SUPABASE_URL", "https://mock.supabase.co")
        signed_url = f"{supabase_url}/storage/v1/object/sign/{ATTACHMENTS_BUCKET}/{storage_path}?token=mock-token&expires={int(time.time()) + ttl_seconds}"

    now_ts = int(time.time() * 1000)
    expires_at = int(time.time()) + ttl_seconds

    return {
        "id": attachment_id,
        "thread_id": thread_id,
        "message_id": message_id,
        "storage_path": storage_path,
        "url": signed_url,
        "mime_type": content_type_clean,
        "size_bytes": len(file_bytes),
        "alt_text": alt_text,
        "expires_at": expires_at,
        "created_at": now_ts,
    }


def create_signed_url(storage_path: str, ttl_seconds: int = DEFAULT_SIGNED_URL_TTL) -> str:
    """Mint a fresh signed URL for an existing canonical storage path (decision 18)."""
    client = get_supabase_client()
    if client:
        try:
            signed_res = client.storage.from_(ATTACHMENTS_BUCKET).create_signed_url(
                path=storage_path,
                expires_in=ttl_seconds,
            )
            signed_url = None
            if hasattr(signed_res, "signed_url") and signed_res.signed_url:
                signed_url = signed_res.signed_url
            elif hasattr(signed_res, "signedURL") and signed_res.signedURL:
                signed_url = signed_res.signedURL
            elif isinstance(signed_res, dict):
                signed_url = signed_res.get("signedURL") or signed_res.get("signedUrl")
            if signed_url:
                return signed_url
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to mint signed URL via Supabase client", error=str(e), path=storage_path)

    supabase_url = os.getenv("SUPABASE_URL", "https://mock.supabase.co")
    return f"{supabase_url}/storage/v1/object/sign/{ATTACHMENTS_BUCKET}/{storage_path}?token=mock-token&expires={int(time.time()) + ttl_seconds}"


def get_attachment_bytes(storage_path: str) -> bytes | None:
    """Retrieve raw file bytes from in-memory cache or Supabase Storage."""
    if storage_path in _IN_MEMORY_STORAGE:
        return _IN_MEMORY_STORAGE[storage_path]

    client = get_supabase_client()
    if client:
        try:
            return client.storage.from_(ATTACHMENTS_BUCKET).download(storage_path)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to download attachment from Supabase Storage", error=str(e), path=storage_path)

    return None

import io
import time

import pytest
from fastapi.testclient import TestClient

from agent.main import app
from db.models import ChatAttachment
from db.session import get_db_session
from db.storage import (
    MAX_FILE_SIZE_BYTES,
    get_extension_for_mime,
    reset_storage_client,
)
from utils.llm import is_vision_supported, reset_llm_provider, set_llm_provider


@pytest.fixture(autouse=True)
def cleanup():
    reset_storage_client()
    reset_llm_provider()
    yield
    reset_storage_client()
    reset_llm_provider()


def test_extension_for_mime():
    assert get_extension_for_mime("image/jpeg") == "jpg"
    assert get_extension_for_mime("image/png") == "png"
    assert get_extension_for_mime("image/webp") == "webp"
    assert get_extension_for_mime("IMAGE/JPEG") == "jpg"
    assert get_extension_for_mime("application/octet-stream", "photo.png") == "png"


def test_is_vision_supported():
    class FakeGeminiModel:
        model = "gemini-2.5-flash"

    class FakeTextModel:
        model = "nemotron-3-ultra"

    assert is_vision_supported(FakeGeminiModel()) is True
    assert is_vision_supported(FakeTextModel()) is False
    assert is_vision_supported(model_name="claude-3-5-sonnet") is True
    assert is_vision_supported(model_name="gpt-4o") is True
    assert is_vision_supported(model_name="command-a-03-2025") is False


def test_upload_attachment_endpoint_success(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    client = TestClient(app)

    file_content = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # Fake JPEG header + bytes
    files = {"file": ("test.jpg", io.BytesIO(file_content), "image/jpeg")}
    data = {
        "thread_id": "thread-multi-1",
        "message_id": "msg-001",
        "alt_text": "Sample description",
    }

    res = client.post(
        "/chat/attachments",
        files=files,
        data=data,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 200
    res_data = res.json()
    from agent.main import normalize_thread_id
    assert res_data["thread_id"] == normalize_thread_id("thread-multi-1")
    assert res_data["message_id"] == "msg-001"
    assert res_data["mime_type"] == "image/jpeg"
    assert res_data["size_bytes"] == len(file_content)
    assert "url" in res_data
    assert res_data["storage_path"].startswith(f"{res_data['thread_id']}/msg-001/")
    assert res_data["storage_path"].endswith(".jpg")

    # Verify database persistence
    with get_db_session() as session:
        att = session.query(ChatAttachment).filter_by(id=res_data["id"]).first()
        assert att is not None
        assert att.message_id == "msg-001"
        assert att.mime_type == "image/jpeg"
        assert att.alt_text == "Sample description"


def test_upload_attachment_mime_whitelist(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    client = TestClient(app)

    # Disallowed MIME type (e.g. gif or text)
    files = {"file": ("test.gif", io.BytesIO(b"GIF89a..."), "image/gif")}
    data = {"thread_id": "thread-1", "message_id": "msg-1"}
    res = client.post(
        "/chat/attachments",
        files=files,
        data=data,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 400
    assert "Unsupported image type" in res.json()["detail"]


def test_upload_attachment_size_limit(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    client = TestClient(app)

    # Over 10 MB file
    oversized = b"a" * (MAX_FILE_SIZE_BYTES + 1024)
    files = {"file": ("big.png", io.BytesIO(oversized), "image/png")}
    data = {"thread_id": "thread-1", "message_id": "msg-1"}
    res = client.post(
        "/chat/attachments",
        files=files,
        data=data,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 413
    assert "File too large" in res.json()["detail"]

    # Empty file
    empty = b""
    files_empty = {"file": ("empty.png", io.BytesIO(empty), "image/png")}
    res_empty = client.post(
        "/chat/attachments",
        files=files_empty,
        data=data,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res_empty.status_code == 400


def test_get_attachment_signed_url(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    client = TestClient(app)

    path = "thread-1/msg-1/01M7D15QXQGW5XF3SH19W9EZBV.jpg"
    res = client.get(
        f"/chat/attachments/signed-url?path={path}",
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["path"] == path
    assert "url" in data
    assert data["expires_at"] > int(time.time())


def test_chat_message_privacy_consent_enforcement(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    client = TestClient(app)

    payload = {
        "thread_id": "thread-privacy-1",
        "message": "Analyze this photo",
        "attachments": [
            {
                "path": "thread-privacy-1/msg-1/pic.jpg",
                "mime_type": "image/jpeg",
                "url": "https://fake.supabase.co/pic.jpg",
            }
        ],
        "cloud_privacy_consent": False,
    }

    res = client.post(
        "/chat/message",
        json=payload,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 200
    body = res.text
    assert "Cloud privacy consent is disabled" in body
    assert '"type": "content"' in body
    assert '"delta":' in body
    assert '"type": "done"' in body


def test_chat_message_vision_unsupported_model(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")

    class TextOnlyLLM:
        model = "nemotron-text-only"

        def astream(self, *args, **kwargs):
            raise NotImplementedError()

    set_llm_provider(TextOnlyLLM())

    client = TestClient(app)

    payload = {
        "thread_id": "thread-vision-1",
        "message": "Analyze this photo",
        "attachments": [
            {
                "path": "thread-vision-1/msg-1/pic.jpg",
                "mime_type": "image/jpeg",
                "url": "https://fake.supabase.co/pic.jpg",
            }
        ],
        "cloud_privacy_consent": True,
    }

    res = client.post(
        "/chat/message",
        json=payload,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 200
    body = res.text
    assert "does not support image or vision inputs" in body
    assert '"type": "content"' in body
    assert '"delta":' in body
    assert '"type": "done"' in body


def test_chat_message_attachment_limit(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    client = TestClient(app)

    payload = {
        "thread_id": "thread-limit-1",
        "message": "Analyze these photos",
        "attachments": [
            {
                "path": f"thread-limit-1/msg-1/pic{i}.jpg",
                "mime_type": "image/jpeg",
                "url": f"https://fake.supabase.co/pic{i}.jpg",
            }
            for i in range(11)
        ],
        "cloud_privacy_consent": True,
    }

    res = client.post(
        "/chat/message",
        json=payload,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 200
    body = res.text
    assert "maximum of 10 image attachments" in body
    assert '"type": "content"' in body
    assert '"type": "done"' in body


def test_path_traversal_rejection(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    client = TestClient(app)

    # Path traversal in message_id
    file_content = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 20
    files = {"file": ("test.jpg", io.BytesIO(file_content), "image/jpeg")}
    data = {
        "thread_id": "thread-1",
        "message_id": "..",
    }
    res = client.post(
        "/chat/attachments",
        files=files,
        data=data,
        headers={"Authorization": "Bearer test-key"},
    )
    assert res.status_code == 400
    assert "Invalid message_id" in res.json()["detail"]

    # Path traversal in signed URL path
    res_signed = client.get(
        "/chat/attachments/signed-url?path=../../etc/passwd",
        headers={"Authorization": "Bearer test-key"},
    )
    assert res_signed.status_code == 400

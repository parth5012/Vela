import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
from agent.main import app
from gateway.carbonvoice import CarbonVoiceGateway
from langchain_core.messages import AIMessage

client = TestClient(app)

@pytest.fixture
def mock_db():
    db = MagicMock()
    db.get_oauth_tokens.return_value = {
        "access_token": "mock_access_token",
        "refresh_token": "mock_refresh_token",
        "expiry": "2026-07-24T12:00:00Z"
    }
    return db

@pytest.fixture
def mock_graph_invoke():
    with patch("gateway.carbonvoice.graph.ainvoke", new_callable=AsyncMock) as mock:
        mock.return_value = {
            "messages": [
                AIMessage(content="Hello! I am Vela, your assistant. How can I help you?")
            ]
        }
        yield mock

@pytest.fixture
def mock_google_drive():
    with patch("gateway.carbonvoice.get_google_credentials") as mock_get_creds, \
         patch("gateway.carbonvoice.upload_to_google_drive") as mock_upload:
        mock_get_creds.return_value = MagicMock()
        mock_upload.return_value = "mock-drive-file-id"
        yield mock_get_creds, mock_upload

@pytest.fixture
def mock_httpx_get():
    with patch("httpx.AsyncClient.get") as mock_get:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"mock audio content"
        mock_response.headers = {"content-type": "audio/wav"}
        mock_get.return_value = mock_response
        yield mock_get

@pytest.mark.asyncio
async def test_carbonvoice_gateway_success(mock_db, mock_graph_invoke, mock_google_drive, mock_httpx_get):
    gateway = CarbonVoiceGateway(db=mock_db)
    
    payload = {
        "transcript": "Hello Vela, please record this note.",
        "conversation_id": "test-conv-123",
        "audio_url": "https://example.com/audio.wav"
    }
    
    result = await gateway.handle_webhook(payload=payload)
    
    assert result["status"] == "success"
    assert result["conversation_id"] == "f079ca9e-de8d-5ad7-baf8-7323f8d63301"
    assert result["transcription"] == "Hello Vela, please record this note."
    assert "Hello! I am Vela" in result["assistant_response"]
    assert result["dataset_collection"]["saved_to_drive"] is True
    assert result["dataset_collection"]["drive_audio_file_id"] == "mock-drive-file-id"
    assert result["dataset_collection"]["drive_text_file_id"] == "mock-drive-file-id"

@pytest.mark.asyncio
async def test_carbonvoice_gateway_no_google_credentials(mock_db, mock_graph_invoke):
    # Setup db to return no credentials
    mock_db.get_oauth_tokens.return_value = None
    
    # We patch get_google_credentials directly to return None
    with patch("gateway.carbonvoice.get_google_credentials", return_value=None):
        gateway = CarbonVoiceGateway(db=mock_db)
        payload = {
            "transcript": "No google drive token test",
            "conversation_id": "test-conv-456"
        }
        
        result = await gateway.handle_webhook(payload=payload)
        
    assert result["status"] == "success"
    assert result["dataset_collection"]["saved_to_drive"] is False
    assert result["dataset_collection"]["drive_audio_file_id"] is None
    assert result["dataset_collection"]["drive_text_file_id"] is None
    assert "Hello! I am Vela" in result["assistant_response"]

@pytest.mark.asyncio
async def test_carbonvoice_gateway_nested_payload(mock_db, mock_graph_invoke, mock_google_drive, mock_httpx_get):
    gateway = CarbonVoiceGateway(db=mock_db)

    payload = {
        "event": "message.finished",
        "data": {
            "message": {
                "id": "msg-123",
                "transcript": "Hello Vela, please record note.",
                "audio": {
                    "url": "https://example.com/audio.wav"
                },
                "conversation": {
                    "id": "test-conv-123",
                    "type": "channel",
                    "folder_id": None,
                    "conversation_sequence": 4,
                    "status": "active"
                }
            }
        }
    }

    result = await gateway.handle_webhook(payload=payload)

    assert result["status"] == "success"
    assert result["conversation_id"] == "f079ca9e-de8d-5ad7-baf8-7323f8d63301"
    assert result["transcription"] == "Hello Vela, please record note."
    assert "Hello! I am Vela" in result["assistant_response"]
    assert result["dataset_collection"]["saved_to_drive"] is True

def test_carbonvoice_webhook_endpoint_json(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    
    mock_result = {
        "status": "success",
        "conversation_id": "mock-conv-id",
        "transcription": "Hello World",
        "assistant_response": "Hi there!",
        "dataset_collection": {"saved_to_drive": False, "drive_audio_file_id": None, "drive_text_file_id": None}
    }
    
    # Patch handle_webhook of the gateway class used in endpoint
    with patch("gateway.carbonvoice.CarbonVoiceGateway.handle_webhook", new_callable=AsyncMock) as mock_handle:
        mock_handle.return_value = mock_result

        response = client.post(
            "/webhooks/carbonvoice",
            json={"transcript": "Hello World", "conversation_id": "test-conv"},
            headers={"Authorization": "Bearer test-key"}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "success"
        assert response.json()["assistant_response"] == "Hi there!"
        mock_handle.assert_called_once()

def test_carbonvoice_webhook_endpoint_multipart(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key")
    
    mock_result = {
        "status": "success",
        "conversation_id": "mock-conv-id",
        "transcription": "Hello from file",
        "assistant_response": "Hi from assistant!",
        "dataset_collection": {"saved_to_drive": True, "drive_audio_file_id": "123", "drive_text_file_id": "456"}
    }
    
    with patch("gateway.carbonvoice.CarbonVoiceGateway.handle_webhook", new_callable=AsyncMock) as mock_handle:
        mock_handle.return_value = mock_result
        
        # Prepare multipart/form-data
        data = {
            "transcript": "Hello from file",
            "conversation_id": "test-conv"
        }
        files = {
            "file": ("test.wav", b"mock audio content", "audio/wav")
        }
        
        response = client.post(
            "/webhooks/carbonvoice",
            data=data,
            files=files,
            headers={"Authorization": "Bearer test-key"}
        )
        
        assert response.status_code == 200
        assert response.json()["status"] == "success"
        assert response.json()["dataset_collection"]["saved_to_drive"] is True
        
        # Verify the call parameters
        args, kwargs = mock_handle.call_args
        assert kwargs["payload"]["transcript"] == "Hello from file"
        assert kwargs["payload"]["conversation_id"] == "test-conv"
        assert kwargs["audio_file_bytes"] == b"mock audio content"
        assert kwargs["audio_filename"] == "test.wav"
        assert kwargs["audio_mime_type"] == "audio/wav"


@pytest.mark.asyncio
async def test_carbonvoice_gateway_official_payload(mock_db, mock_graph_invoke, mock_google_drive, mock_httpx_get):
    gateway = CarbonVoiceGateway(db=mock_db)

    payload = {
        "eventName": "message.posted.to.channel",
        "data": {
            "eventName": "message.posted.to.channel",
            "resourceId": "msg_98765",
            "resourceType": "message",
            "resource": {
                "id": "msg_98765",
                "channel_id": "chan_54321",
                "transcript_txt": "Hello Vela, please record note.",
                "audio_stream_url": "https://example.com/audio.wav",
                "status": "FINISHED"
            }
        }
    }

    result = await gateway.handle_webhook(payload=payload)

    assert result["status"] == "success"
    assert result["conversation_id"] is not None
    assert result["transcription"] == "Hello Vela, please record note."
    assert "Hello! I am Vela" in result["assistant_response"]
    assert result["dataset_collection"]["saved_to_drive"] is True


@pytest.mark.asyncio
async def test_carbonvoice_gateway_sends_reply(mock_db, mock_graph_invoke, mock_google_drive):
    gateway = CarbonVoiceGateway(db=mock_db)

    payload = {
        "eventName": "message.posted.to.channel",
        "data": {
            "eventName": "message.posted.to.channel",
            "resourceId": "msg_98765",
            "resourceType": "message",
            "resource": {
                "id": "msg_98765",
                "channel_id": "chan_54321",
                "transcript_txt": "Hello Vela, please record note.",
                "audio_stream_url": "https://example.com/audio.wav",
                "status": "FINISHED"
            }
        }
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b"success"

    with patch("httpx.AsyncClient.get") as mock_get, \
         patch("httpx.AsyncClient.post") as mock_post:
        
        mock_get.return_value = MagicMock(status_code=200, content=b"audio data", headers={"content-type": "audio/wav"})
        mock_post.return_value = mock_response

        result = await gateway.handle_webhook(payload=payload, auth_header="Bearer test-token")

        assert result["status"] == "success"
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "https://api.carbonvoice.app/v3/messages/start"
        assert kwargs["headers"]["Authorization"] == "Bearer test-token"
        assert kwargs["json"]["channel_id"] == "chan_54321"
        assert "Hello! I am Vela" in kwargs["json"]["transcript"]


def test_get_google_credentials_fallback():
    from utils.google_drive import get_google_credentials
    mock_db = MagicMock()
    # First call returns None (specific conversation has no token)
    # Second call (attribute lookup on get_latest_oauth_tokens) returns a valid dict
    mock_db.get_oauth_tokens.return_value = None
    mock_db.get_latest_oauth_tokens.return_value = {
        "access_token": "fallback-access-token",
        "refresh_token": "fallback-refresh-token",
        "expiry": "2026-07-26T12:00:00Z"
    }

    with patch("utils.google_drive.os.getenv") as mock_getenv, \
         patch("utils.google_drive.Credentials") as mock_credentials_class, \
         patch("utils.google_drive.Request") as mock_request_class:
        
        # Ensure no global environment fallback is active in this test branch
        mock_getenv.side_effect = lambda name: "mock-value" if name in ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] else None
        
        # When construction occurs, return a mock credentials object
        mock_creds = MagicMock()
        mock_creds.expired = True
        mock_creds.refresh_token = "fallback-refresh-token"
        mock_creds.token = "new-access-token"
        mock_creds.expiry = MagicMock()
        mock_creds.expiry.isoformat.return_value = "2026-07-26T13:00:00Z"
        
        mock_credentials_class.return_value = mock_creds

        result = get_google_credentials("cv-conv-uuid", mock_db)
        
        # Check that it fell back, refreshed the credentials, and saved them
        assert result == mock_creds
        mock_db.get_latest_oauth_tokens.assert_called_with("google")
        mock_db.store_oauth_tokens.assert_called_once()


from gateway.carbonvoice import is_safe_audio_url

def test_is_safe_audio_url_blocks_private_ranges():
    assert not is_safe_audio_url("http://127.0.0.1/audio.wav")
    assert not is_safe_audio_url("http://169.254.169.254/latest/meta-data/")
    assert not is_safe_audio_url("http://10.0.0.1/audio.wav")
    assert not is_safe_audio_url("http://172.16.0.1/audio.wav")
    assert not is_safe_audio_url("http://192.168.1.1/audio.wav")
    assert not is_safe_audio_url("http://localhost/audio.wav")
    assert not is_safe_audio_url("file:///etc/passwd")


# ---------------------------------------------------------------------------
# is_safe_audio_url — positive paths and resolution edge cases (mocked DNS,
# no real network access in unit tests)
# ---------------------------------------------------------------------------

import socket as _socket

PUBLIC_V4 = [( _socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]
PUBLIC_V6 = [(_socket.AF_INET6, _socket.SOCK_STREAM, 6, "", ("2606:2800:220:1:248:1893:25c8:1946", 0, 0, 0))]


def _addrinfo(*entries):
    return list(entries)


def test_is_safe_audio_url_allows_public_ipv4():
    """Positive guard: a legitimate public URL must NOT be blocked."""
    with patch("gateway.carbonvoice.socket.getaddrinfo", return_value=_addrinfo(*PUBLIC_V4)):
        assert is_safe_audio_url("https://cdn.example.com/audio.wav") is True


def test_is_safe_audio_url_allows_public_ipv6():
    with patch("gateway.carbonvoice.socket.getaddrinfo", return_value=_addrinfo(*PUBLIC_V6)):
        assert is_safe_audio_url("https://cdn.example.com/audio.wav") is True


def test_is_safe_audio_url_blocks_when_any_resolved_address_is_private():
    """DNS rebinding defense: one private A record among public ones blocks."""
    mixed = PUBLIC_V4 + [
        (_socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("192.168.1.50", 0))
    ]
    with patch("gateway.carbonvoice.socket.getaddrinfo", return_value=_addrinfo(*mixed)):
        assert is_safe_audio_url("https://rebind.example.com/audio.wav") is False


@pytest.mark.parametrize(
    "resolved_ip",
    [
        ("127.0.0.1", "loopback"),
        ("::1", "ipv6 loopback"),
        ("169.254.169.254", "link-local metadata"),
        ("224.0.0.1", "multicast"),
        ("240.0.0.1", "reserved"),
        ("0.0.0.0", "unspecified"),
    ],
)
def test_is_safe_audio_url_blocks_dangerous_resolved_addresses(resolved_ip):
    ip, _label = resolved_ip
    entries = [(_socket.AF_INET, _socket.SOCK_STREAM, 6, "", (ip, 0))]
    with patch("gateway.carbonvoice.socket.getaddrinfo", return_value=entries):
        assert is_safe_audio_url(f"https://evil.example.com/audio.wav") is False


def test_is_safe_audio_url_rejects_unresolvable_hostname():
    """DNS failure must fail closed."""
    with patch(
        "gateway.carbonvoice.socket.getaddrinfo",
        side_effect=_socket.gaierror("Name or service not known"),
    ):
        assert is_safe_audio_url("https://does-not-exist.example.com/a.wav") is False


def test_is_safe_audio_url_rejects_missing_hostname():
    assert is_safe_audio_url("http:///audio.wav") is False


def test_is_safe_audio_url_rejects_non_http_schemes():
    assert is_safe_audio_url("ftp://cdn.example.com/audio.wav") is False
    assert is_safe_audio_url("gopher://cdn.example.com/audio.wav") is False

@pytest.mark.asyncio
async def test_carbonvoice_gateway_blocks_ssrf_urls(mock_db, mock_graph_invoke, mock_google_drive):
    gateway = CarbonVoiceGateway(db=mock_db)
    payload = {
        "audio_url": "http://169.254.169.254/latest/meta-data/",
        "text": "Hello world"
    }
    with patch("httpx.AsyncClient.get") as mock_get:
        response = await gateway.handle_webhook(payload=payload)
        # Verify httpx.get was NEVER called for the unsafe URL
        mock_get.assert_not_called()
        assert response["status"] == "success"

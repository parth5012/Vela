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
    with patch("gateway.carbonvoice.graph.invoke") as mock:
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

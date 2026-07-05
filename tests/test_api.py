from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from agent.main import app

client = TestClient(app)

def test_health_endpoint(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "super-secret-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    response = client.get("/health", headers={"Authorization": "Bearer super-secret-key"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_endpoints_require_api_key_auth(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "super-secret-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    
    # 1. Access without key
    resp = client.get("/health")
    assert resp.status_code == 403
    
    # 2. Access with wrong key
    resp = client.get("/health", headers={"Authorization": "Bearer bad-key"})
    assert resp.status_code == 401
    
    # 3. Access with valid key
    resp = client.get("/health", headers={"Authorization": "Bearer super-secret-key"})
    assert resp.status_code == 200


def test_conversation_rest_endpoints(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    headers = {"Authorization": "Bearer secret-test-key"}
    
    # 1. Check get threads
    resp = client.get("/chat/threads", headers=headers)
    assert resp.status_code == 200
    initial_length = len(resp.json())

    # 2. Check get thread history for non-existent thread returns 500 or 404
    resp = client.get("/chat/threads/non-existent-uuid", headers=headers)
    assert resp.status_code == 500 or resp.status_code == 404


def test_streaming_chat_message(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    
    headers = {"Authorization": "Bearer secret-test-key"}
    payload = {"thread_id": "conv-123", "message": "Verify math $1+1=2$"}
    
    # We will test sending a message
    with client.stream("POST", "/chat/message", json=payload, headers=headers) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]


def test_streaming_chat_message_with_personas(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    
    headers = {"Authorization": "Bearer secret-test-key"}
    
    # 1. Test invalid persona returns 400
    payload_invalid = {"thread_id": "conv-124", "message": "hello", "persona": "wizard"}
    resp = client.post("/chat/message", json=payload_invalid, headers=headers)
    assert resp.status_code == 400
    assert "Unsupported persona" in resp.json()["detail"]

    # 2. Test valid persona "teacher" starts stream successfully
    payload_valid = {"thread_id": "conv-125", "message": "Can you teach me binary search?", "persona": "teacher"}
    with client.stream("POST", "/chat/message", json=payload_valid, headers=headers) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        
    # 3. Test list threads returns persona
    resp = client.get("/chat/threads", headers=headers)
    assert resp.status_code == 200
    threads = resp.json()
    assert len(threads) > 0
    # The created conversation from previous stream should be in the list, check if persona exists in keys
    assert "persona" in threads[0]



# @patch("agent.main.discord_gateway.start", new_callable=AsyncMock)
# @patch("agent.main.discord_gateway.close", new_callable=AsyncMock)
# def test_lifespan_starts_and_stops_discord_gateway(mock_close, mock_start):
#     from agent.main import app
#     from unittest.mock import patch, AsyncMock
#     with TestClient(app) as client:
#         # Verify health check is accessible
#         response = client.get("/health")
#         assert response.status_code == 200
#     
#     mock_start.assert_called_once()
#     mock_close.assert_called_once()

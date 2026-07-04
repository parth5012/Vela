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

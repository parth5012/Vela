from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from agent.main import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

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

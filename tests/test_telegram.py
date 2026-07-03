from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from agent.main import app

client = TestClient(app)

@patch("agent.main.telegram_gateway.handle_update", new_callable=AsyncMock)
def test_telegram_webhook_post(mock_handle_update):
    mock_handle_update.return_value = "Processed and replied: Mocked response content"
    
    payload = {
        "update_id": 10000,
        "message": {
            "message_id": 1,
            "date": 1441645532,
            "chat": {
                "id": 1111,
                "type": "private",
                "username": "testuser"
            },
            "text": "Hello assistant"
        }
    }
    response = client.post("/webhooks/telegram", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "processed"
    assert response.json()["result"] == "Task scheduled in background"
    mock_handle_update.assert_called_once_with(payload)


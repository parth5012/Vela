from fastapi.testclient import TestClient
from agent.main import app

client = TestClient(app)

def test_telegram_webhook_post():
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

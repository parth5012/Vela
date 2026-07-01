from fastapi.testclient import TestClient
from agent.main import app

client = TestClient(app)

def test_consolidate_endpoint():
    response = client.post("/consolidate")
    assert response.status_code == 200
    assert response.json()["status"] == "success"

from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from agent.main import app

client = TestClient(app)

@patch("agent.main.Flow")
@patch("agent.main.db")
def test_oauth_login_redirect(mock_db, mock_flow_class):
    mock_flow = MagicMock()
    mock_flow.authorization_url.return_value = ("https://google.com/auth?state=123", "state123")
    mock_flow_class.from_client_config.return_value = mock_flow
    
    response = client.get("/oauth/login?chat_id=123", follow_redirects=False)
    assert response.status_code == 307
    assert "google.com/auth" in response.headers["location"]

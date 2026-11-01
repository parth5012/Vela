import pytest
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect

from agent.main import app


def test_omni_websocket_rejects_unauthenticated(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-vela-key")
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info, client.websocket_connect("/ws/omni?token=wrong-key") as ws:
        ws.receive_json()
    assert exc_info.value.code == 1008


def test_omni_websocket_session_lifecycle(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-vela-key")
    client = TestClient(app)
    with client.websocket_connect("/ws/omni?token=test-vela-key") as ws:
        # 1. Server greets with session_ready
        greeting = ws.receive_json()
        assert greeting["type"] == "session_ready"
        assert greeting["model"] == "liquid-lfm-omni"
        assert "session_id" in greeting

        # 2. Ping-pong
        ws.send_json({"type": "ping"})
        pong = ws.receive_json()
        assert pong["type"] == "pong"

        # 3. Text prompt turn
        ws.send_json({"type": "text_prompt", "text": "Hello Vela Omni"})
        msg = ws.receive_json()
        # Either transcript token or turn_complete
        assert msg["type"] in ("transcript_token", "turn_complete")

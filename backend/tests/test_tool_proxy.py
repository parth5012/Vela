import os
import pytest
from fastapi.testclient import TestClient
from agent.main import app, RATE_LIMIT_STORE
from db.session import get_db_session
from db.models import Conversation, ToolInvocation, SyncMessage
from db.client import DBClient
from utils.ulid import generate_ulid
from unittest.mock import MagicMock, patch
from langchain_core.tools import tool

# Clear DB fixture for isolation
@pytest.fixture(autouse=True)
def clean_db():
    with get_db_session() as session:
        session.query(SyncMessage).delete()
        session.query(ToolInvocation).delete()
        session.query(Conversation).delete()
        session.commit()
    yield

# Mutable tools list swap fixture
@pytest.fixture(autouse=True)
def mock_web_search():
    from tools import tools_list
    
    # Find original index
    idx = next(i for i, t in enumerate(tools_list) if t.name == "web_search")
    orig_tool = tools_list[idx]
    
    mock_func = MagicMock()
    mock_func.return_value = "Mocked Search Response"
    
    @tool
    def web_search(query: str) -> str:
        """Search web up-to-date information query."""
        return mock_func(query)
        
    tools_list[idx] = web_search
    yield mock_func
    # Restore
    tools_list[idx] = orig_tool

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key-123")
    return TestClient(app)

@pytest.fixture
def headers():
    return {"Authorization": "Bearer test-key-123"}

def test_manifest_success(client, headers):
    resp = client.get("/api/tools/manifest?agent_id=personal assistant", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "tools" in data
    assert "max_tools_hint" in data
    assert len(data["tools"]) <= 3
    for t in data["tools"]:
        assert "name" in t
        assert "description" in t
        assert "parameters" in t

def test_manifest_unknown_agent(client, headers):
    resp = client.get("/api/tools/manifest?agent_id=unknown_agent", headers=headers)
    assert resp.status_code == 400
    assert "Unknown agent_id" in resp.json()["detail"]

def test_manifest_unauthorized(client):
    resp = client.get("/api/tools/manifest?agent_id=personal assistant")
    assert resp.status_code == 403

    resp = client.get("/api/tools/manifest?agent_id=personal assistant", headers={"Authorization": "Bearer bad-key"})
    assert resp.status_code == 401

def test_invoke_unauthorized(client):
    payload = {
        "conversation_id": "test-uuid",
        "tool_name": "web_search",
        "arguments": {"query": "test"},
        "request_id": generate_ulid()
    }
    resp = client.post("/api/tools/invoke", json=payload)
    assert resp.status_code == 403

    resp = client.post("/api/tools/invoke", json=payload, headers={"Authorization": "Bearer bad-key"})
    assert resp.status_code == 401

def test_invoke_unknown_tool(client, headers):
    payload = {
        "conversation_id": "test-uuid",
        "tool_name": "unknown_tool_999",
        "arguments": {},
        "request_id": generate_ulid()
    }
    resp = client.post("/api/tools/invoke", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "error"
    assert data["error"]["code"] == "UNKNOWN_TOOL"

def test_invoke_success_and_idempotency(client, headers, mock_web_search):
    with get_db_session() as session:
        db_client = DBClient(session)
        conv = db_client.create_client_conversation(
            title="Android Thread",
            agent="personal assistant",
            source="android_client"
        )
        conv_id = conv.id
        session.commit()

    req_id = generate_ulid()
    payload = {
        "conversation_id": conv_id,
        "tool_name": "web_search",
        "arguments": {"query": "fastapi"},
        "request_id": req_id
    }
    
    mock_web_search.return_value = "Mocked Search Response"
    
    resp1 = client.post("/api/tools/invoke", json=payload, headers=headers)
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["status"] == "success"
    assert data1["result"] == "Mocked Search Response"
    
    mock_web_search.return_value = "Should not be called"
    resp2 = client.post("/api/tools/invoke", json=payload, headers=headers)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["status"] == "success"
    assert data2["result"] == "Mocked Search Response"
    assert mock_web_search.call_count == 1

def test_invoke_rate_limiting(client, headers, mock_web_search):
    RATE_LIMIT_STORE.clear()
    payload = {
        "conversation_id": "rate-limit-thread",
        "tool_name": "web_search",
        "arguments": {"query": "fastapi"},
        "request_id": generate_ulid()
    }
    
    mock_web_search.return_value = "OK"
    
    for i in range(10):
        payload["request_id"] = generate_ulid()
        resp = client.post("/api/tools/invoke", json=payload, headers=headers)
        assert resp.status_code == 200
        
    payload["request_id"] = generate_ulid()
    resp = client.post("/api/tools/invoke", json=payload, headers=headers)
    assert resp.status_code == 429

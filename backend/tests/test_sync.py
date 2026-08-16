import os
import time
import pytest
from fastapi.testclient import TestClient
from agent.main import app
from db.session import get_db_session
from db.models import Conversation, SyncMessage, ToolInvocation
from db.client import DBClient
from utils.ulid import generate_ulid

# Clear DB fixture for isolation
@pytest.fixture(autouse=True)
def clean_db():
    with get_db_session() as session:
        session.query(SyncMessage).delete()
        session.query(ToolInvocation).delete()
        session.query(Conversation).delete()
        session.commit()
    yield

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "test-key-123")
    return TestClient(app)

@pytest.fixture
def headers():
    return {"Authorization": "Bearer test-key-123"}

def test_sync_push_unauthorized(client):
    payload = {
        "operations": []
    }
    resp = client.post("/api/sync/push", json=payload)
    assert resp.status_code == 403

def test_sync_pull_unauthorized(client):
    resp = client.get("/api/sync/pull")
    assert resp.status_code == 403

def test_sync_push_success_and_deduplication(client, headers):
    with get_db_session() as session:
        db_client = DBClient(session)
        conv1 = db_client.create_client_conversation(
            title="Sync Push Android thread",
            agent="personal assistant",
            source="android_client"
        )
        conv_id1 = conv1.id
        
        conv2 = db_client.create_client_conversation(
            title="Non-Android thread",
            agent="personal assistant",
            source="telegram"
        )
        conv_id2 = conv2.id
        session.commit()

    ulid1 = generate_ulid()
    ulid2 = generate_ulid()
    
    payload = {
        "operations": [
            {
                "id": ulid1,
                "type": "message",
                "conversation_id": conv_id1,
                "payload": {
                    "role": "user",
                    "content": "Hello world from Android!",
                    "provider": "android_client",
                    "created_at": int(time.time() * 1000)
                }
            },
            {
                "id": ulid2,
                "type": "message",
                "conversation_id": conv_id2,
                "payload": {
                    "role": "user",
                    "content": "Should not be processed",
                    "provider": "telegram",
                    "created_at": int(time.time() * 1000)
                }
            }
        ]
    }

    resp = client.post("/api/sync/push", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert ulid1 in data["accepted"]
    assert ulid2 in data["rejected"]
    
    resp_dup = client.post("/api/sync/push", json=payload, headers=headers)
    assert resp_dup.status_code == 200
    data_dup = resp_dup.json()
    assert ulid1 in data_dup["accepted"]
    assert ulid2 in data_dup["rejected"]

def test_sync_push_auto_creates_missing_android_conversation(client, headers):
    """A local-first offline thread (no backend conversation yet) is
    auto-created as an android_client conversation on first push."""
    local_thread_id = "11111111-2222-4333-8444-555555555555"
    ulid1 = generate_ulid()

    payload = {
        "operations": [
            {
                "id": ulid1,
                "type": "message",
                "conversation_id": local_thread_id,
                "payload": {
                    "role": "user",
                    "content": "Offline message from device",
                    "provider": "android_client",
                    "created_at": int(time.time() * 1000)
                }
            }
        ]
    }

    resp = client.post("/api/sync/push", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert ulid1 in data["accepted"]

    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=local_thread_id).first()
        assert conv is not None
        assert conv.source == "android_client"

        # The pushed message must be stored and not echo back on pull
        # (provider == android_client is excluded by the pull filter).
        msg = session.query(SyncMessage).filter_by(id=ulid1).first()
        assert msg is not None
        assert msg.role == "user"
        assert msg.content == "Offline message from device"

    pull_resp = client.get("/api/sync/pull", headers=headers)
    assert pull_resp.status_code == 200
    assert pull_resp.json()["operations"] == []


def test_sync_pull_scenarios(client, headers):
    with get_db_session() as session:
        db_client = DBClient(session)
        conv = db_client.create_client_conversation(
            title="Sync Pull Thread",
            agent="personal assistant",
            source="android_client"
        )
        conv_id = conv.id
        session.commit()

    ulid1 = generate_ulid()
    ulid2 = generate_ulid()
    ulid3 = generate_ulid()
    
    ulids = sorted([ulid1, ulid2, ulid3])
    
    with get_db_session() as session:
        msg1 = SyncMessage(id=ulids[0], conversation_id=conv_id, role="assistant", content="Response 1", provider="cloud", created_at=1000)
        msg2 = SyncMessage(id=ulids[1], conversation_id=conv_id, role="tool", content="Tool Result", provider="cloud", created_at=2000)
        msg3 = SyncMessage(id=ulids[2], conversation_id=conv_id, role="assistant", content="Response 2", provider="cloud", created_at=3000)
        
        msg_user = SyncMessage(id=generate_ulid(), conversation_id=conv_id, role="user", content="Client User Message", provider="android_client", created_at=1500)
        
        session.add_all([msg1, msg2, msg3, msg_user])
        session.commit()

    resp1 = client.get(f"/api/sync/pull?limit=2", headers=headers)
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert len(data1["operations"]) == 2
    assert data1["operations"][0]["id"] == ulids[0]
    assert data1["operations"][1]["id"] == ulids[1]
    assert data1["has_more"] is True
    
    cursor = data1["cursor"]
    resp2 = client.get(f"/api/sync/pull?cursor={cursor}&limit=50", headers=headers)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert len(data2["operations"]) == 1
    assert data2["operations"][0]["id"] == ulids[2]
    assert data2["has_more"] is False

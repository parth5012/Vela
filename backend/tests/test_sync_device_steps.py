import pytest
from fastapi.testclient import TestClient
from agent.main import app
from db.session import get_db_session
from db.models import Conversation, SyncMessage, ToolInvocation
from db.client import DBClient
from utils.ulid import generate_ulid

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

def test_sync_device_steps_unauthorized(client):
    payload = {
        "conversation_id": "conv_123",
        "events": []
    }
    resp = client.post("/api/sync/device-steps", json=payload)
    assert resp.status_code in [401, 403]

def test_sync_device_steps_success_and_idempotency(client, headers):
    conv_id = f"conv_{generate_ulid()}"
    with get_db_session() as session:
        db_client = DBClient(session)
        conv = db_client.create_client_conversation(
            title="Device Steps Conversation",
            agent="personal assistant",
            conversation_id=conv_id,
            source="android_client"
        )
        session.commit()

    step_id_1 = f"step_{generate_ulid()}"
    step_id_2 = f"step_{generate_ulid()}"

    payload = {
        "conversation_id": conv_id,
        "client_sync_id": "sync_client_001",
        "events": [
            {
                "id": step_id_1,
                "role": "assistant",
                "content": "Reading screen",
                "tool_name": "device_screen_read",
                "status": "executed",
                "observation": "Screen tree elements: Settings",
                "timestamp": 1725700000000
            },
            {
                "id": step_id_2,
                "role": "assistant",
                "content": "Opening root app",
                "tool_name": "device_open_app",
                "target": "Superuser",
                "status": "blocked",
                "observation": "Action blocked by safety policy",
                "timestamp": 1725700001000
            }
        ]
    }

    # First sync call
    resp1 = client.post("/api/sync/device-steps", json=payload, headers=headers)
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["status"] == "ok"
    assert step_id_1 in data1["accepted"]
    assert step_id_2 in data1["accepted"]
    assert data1["processed"] == 2

    # Verify database records
    with get_db_session() as session:
        msgs = session.query(SyncMessage).filter_by(conversation_id=conv_id).all()
        assert len(msgs) == 2

        tools = session.query(ToolInvocation).all()
        assert len(tools) == 2
        tool_names = {t.tool_name for t in tools}
        assert "device_screen_read" in tool_names
        assert "device_open_app" in tool_names

    # Second sync call (idempotent replay)
    resp2 = client.post("/api/sync/device-steps", json=payload, headers=headers)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["status"] == "ok"
    assert data2["processed"] == 2

    # Verify no duplicate entries created
    with get_db_session() as session:
        msgs = session.query(SyncMessage).filter_by(conversation_id=conv_id).all()
        assert len(msgs) == 2
        tools = session.query(ToolInvocation).all()
        assert len(tools) == 2

def test_sync_device_steps_auto_creates_missing_conversation(client, headers):
    new_conv_id = f"conv_{generate_ulid()}"
    step_id = f"step_{generate_ulid()}"

    payload = {
        "conversation_id": new_conv_id,
        "events": [
            {
                "id": step_id,
                "role": "assistant",
                "content": "Inspecting device",
                "tool_name": "device_info",
                "status": "executed",
                "observation": "Battery: 85%",
                "timestamp": 1725700002000
            }
        ]
    }

    resp = client.post("/api/sync/device-steps", json=payload, headers=headers)
    assert resp.status_code == 200

    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=new_conv_id).first()
        assert conv is not None
        assert str(conv.source) == "android_client"

        msg = session.query(SyncMessage).filter_by(id=step_id).first()
        assert msg is not None
        assert str(msg.conversation_id) == new_conv_id

        tool = session.query(ToolInvocation).filter_by(tool_name="device_info").first()
        assert tool is not None
        assert str(tool.result) == "Battery: 85%"

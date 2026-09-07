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

def test_device_sync_unauthorized(client):
    payload = {
        "conversation_id": f"conv_{generate_ulid()}",
        "events": [{"id": f"step_{generate_ulid()}", "tool_name": "device_info"}],
    }
    resp = client.post("/api/sync/device-steps", json=payload)
    assert resp.status_code in [401, 403]

def test_device_sync_end_to_end_flow(client, headers):
    conv_id = f"conv_{generate_ulid()}"
    step_read = f"step_{generate_ulid()}"
    step_click = f"step_{generate_ulid()}"
    step_final = f"step_{generate_ulid()}"

    payload = {
        "conversation_id": conv_id,
        "client_sync_id": f"sync_{generate_ulid()}",
        "events": [
            {
                "id": step_read,
                "role": "assistant",
                "tool_name": "device_screen_read",
                "status": "executed",
                "observation": "Screen hierarchy: Settings > Bluetooth",
                "timestamp": 1725700010000,
            },
            {
                "id": step_click,
                "role": "assistant",
                "tool_name": "device_click",
                "target": "540,1120",
                "status": "executed",
                "observation": "Success",
                "timestamp": 1725700012000,
            },
            {
                "id": step_final,
                "role": "assistant",
                "content": "Bluetooth toggle has been tapped successfully.",
                "status": "completed",
                "timestamp": 1725700015000,
            },
        ],
    }

    resp = client.post("/api/sync/device-steps", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert len(data["accepted"]) == 3

    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=conv_id).first()
        assert conv is not None
        assert str(conv.source) == "android_client"

        msgs = session.query(SyncMessage).filter_by(conversation_id=conv_id).all()
        assert len(msgs) == 3

        tools = session.query(ToolInvocation).all()
        assert len(tools) == 2
        tool_names = {t.tool_name for t in tools}
        assert "device_screen_read" in tool_names
        assert "device_click" in tool_names

def test_device_sync_upsert_status_transition(client, headers):
    conv_id = f"conv_{generate_ulid()}"
    step_id = f"step_{generate_ulid()}"

    # Initial sync with step executing/pending
    payload1 = {
        "conversation_id": conv_id,
        "events": [
            {
                "id": step_id,
                "tool_name": "device_screen_read",
                "status": "running",
                "observation": None,
                "timestamp": 1725700020000,
            }
        ],
    }
    resp1 = client.post("/api/sync/device-steps", json=payload1, headers=headers)
    assert resp1.status_code == 200

    with get_db_session() as session:
        tool1 = session.query(ToolInvocation).filter_by(request_id=step_id).first()
        assert tool1 is not None
        assert str(tool1.status) == "running"

    # Re-sync with completed observation
    payload2 = {
        "conversation_id": conv_id,
        "events": [
            {
                "id": step_id,
                "tool_name": "device_screen_read",
                "status": "executed",
                "observation": "Screen tree captured",
                "timestamp": 1725700021000,
            }
        ],
    }
    resp2 = client.post("/api/sync/device-steps", json=payload2, headers=headers)
    assert resp2.status_code == 200

    with get_db_session() as session:
        tool2 = session.query(ToolInvocation).filter_by(request_id=step_id).first()
        assert tool2 is not None
        assert str(tool2.status) == "executed"
        assert str(tool2.result) == "Screen tree captured"

        # Assert no duplicate ToolInvocation or SyncMessage rows
        assert session.query(ToolInvocation).filter_by(request_id=step_id).count() == 1
        assert session.query(SyncMessage).filter_by(id=step_id).count() == 1

def test_device_sync_rejects_non_client_conversation(client, headers):
    conv_id = f"conv_{generate_ulid()}"
    with get_db_session() as session:
        db_client = DBClient(session)
        db_client.create_client_conversation(
            title="External Telegram Chat",
            agent="personal assistant",
            conversation_id=conv_id,
            source="telegram",
        )
        session.commit()

    payload = {
        "conversation_id": conv_id,
        "events": [
            {
                "id": f"step_{generate_ulid()}",
                "tool_name": "device_info",
                "status": "executed",
            }
        ],
    }

    resp = client.post("/api/sync/device-steps", json=payload, headers=headers)
    assert resp.status_code == 400
    assert "Cannot sync device steps" in resp.json()["detail"]

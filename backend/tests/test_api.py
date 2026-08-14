from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from agent.main import app



def test_health_endpoint(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "super-secret-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    response = client.get("/health", headers={"Authorization": "Bearer super-secret-key"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "tool_proxy": "available"}


def test_endpoints_require_api_key_auth(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "super-secret-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    
    # 1. Access without key
    resp = client.get("/health")
    assert resp.status_code == 403
    
    # 2. Access with wrong key
    resp = client.get("/health", headers={"Authorization": "Bearer bad-key"})
    assert resp.status_code == 401
    
    # 3. Access with valid key
    resp = client.get("/health", headers={"Authorization": "Bearer super-secret-key"})
    assert resp.status_code == 200


def test_conversation_rest_endpoints(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    headers = {"Authorization": "Bearer secret-test-key"}
    
    # 1. Check get threads
    resp = client.get("/chat/threads", headers=headers)
    assert resp.status_code == 200
    initial_length = len(resp.json())

    # 2. Check get thread history for non-existent thread returns 500 or 404
    resp = client.get("/chat/threads/non-existent-uuid", headers=headers)
    assert resp.status_code == 500 or resp.status_code == 404


def test_streaming_chat_message(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    
    headers = {"Authorization": "Bearer secret-test-key"}
    payload = {"thread_id": "conv-123", "message": "Verify math $1+1=2$"}
    
    # We will test sending a message
    with client.stream("POST", "/chat/message", json=payload, headers=headers) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]


def test_streaming_chat_message_with_personas(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    client = TestClient(app)
    
    headers = {"Authorization": "Bearer secret-test-key"}
    
    # 1. Test invalid agent returns 400
    payload_invalid = {"thread_id": "conv-124", "message": "hello", "agent": "wizard"}
    resp = client.post("/chat/message", json=payload_invalid, headers=headers)
    assert resp.status_code == 400
    assert "Unsupported agent" in resp.json()["detail"]

    # 2. Test valid agent "teacher" starts stream successfully
    payload_valid = {"thread_id": "conv-125", "message": "Can you teach me binary search?", "agent": "teacher"}
    with client.stream("POST", "/chat/message", json=payload_valid, headers=headers) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        
    # 3. Test list threads returns agent
    resp = client.get("/chat/threads", headers=headers)
    assert resp.status_code == 200
    threads = resp.json()
    assert len(threads) > 0
    # The created conversation from previous stream should be in the list, check if agent exists in keys
    assert "agent" in threads[0]

    # 4. Test valid agent "prompt builder" starts stream successfully
    payload_pb = {"thread_id": "conv-126", "message": "Help me build a system prompt for a weather bot", "agent": "prompt builder"}
    with client.stream("POST", "/chat/message", json=payload_pb, headers=headers) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

    # 5. Test get personas list endpoint
    resp_personas = client.get("/chat/personas", headers=headers)
    assert resp_personas.status_code == 200
    personas = resp_personas.json()
    assert len(personas) == 5
    persona_ids = [p["id"] for p in personas]
    assert "prompt builder" in persona_ids
    assert "teacher" in persona_ids
    assert "analyst" in persona_ids
    assert "personal assistant" in persona_ids
    assert "google_workspace" in persona_ids



def test_branch_and_truncate_endpoints(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    from db.session import get_db_session
    from db.models import Conversation, Experience
    import uuid
    from datetime import datetime, timedelta

    client = TestClient(app)
    headers = {"Authorization": "Bearer secret-test-key"}

    # Setup parent conversation and some experiences
    parent_id = str(uuid.uuid4())
    new_id = str(uuid.uuid4())
    exp_id1 = str(uuid.uuid4())
    exp_id2 = str(uuid.uuid4())
    exp_id3 = str(uuid.uuid4())

    with get_db_session() as session:
        # Create parent conversation with agent 'teacher'
        parent_conv = Conversation(id=parent_id, title="Parent Thread", agent="teacher")
        session.add(parent_conv)
        session.flush()

        # Add 3 experiences (messages) with incremental timestamps
        now = datetime.utcnow()
        exp1 = Experience(
            id=exp_id1,
            conversation_id=parent_id,
            user_query="Query 1",
            agent_response="Response 1",
            created_at=now - timedelta(minutes=10)
        )
        exp2 = Experience(
            id=exp_id2,
            conversation_id=parent_id,
            user_query="Query 2",
            agent_response="Response 2",
            created_at=now - timedelta(minutes=5)
        )
        exp3 = Experience(
            id=exp_id3,
            conversation_id=parent_id,
            user_query="Query 3",
            agent_response="Response 3",
            created_at=now
        )
        session.add_all([exp1, exp2, exp3])
        session.commit()

    # --- Test Authentication ---
    bad_headers = {"Authorization": "Bearer wrong-key"}
    branch_payload = {
        "parent_thread_id": parent_id,
        "new_thread_id": new_id,
        "upto_message_id": f"usr-{exp_id2}",
        "title": "Branched Thread"
    }
    resp = client.post("/chat/threads/branch", json=branch_payload, headers=bad_headers)
    assert resp.status_code == 401

    truncate_payload = {"upto_message_id": f"usr-{exp_id2}"}
    resp = client.post(f"/chat/threads/{parent_id}/truncate", json=truncate_payload, headers=bad_headers)
    assert resp.status_code == 401

    # --- Test Branching: 404 invalid parent thread ---
    invalid_branch_payload = {
        "parent_thread_id": "non-existent-parent",
        "new_thread_id": new_id,
        "upto_message_id": f"usr-{exp_id2}",
        "title": "Branched Thread"
    }
    resp = client.post("/chat/threads/branch", json=invalid_branch_payload, headers=headers)
    assert resp.status_code == 404
    assert "Parent thread not found" in resp.json()["detail"]

    # --- Test Branching: 404 non-existent upto_message_id ---
    invalid_msg_branch_payload = {
        "parent_thread_id": parent_id,
        "new_thread_id": new_id,
        "upto_message_id": "usr-non-existent-msg",
        "title": "Branched Thread"
    }
    resp = client.post("/chat/threads/branch", json=invalid_msg_branch_payload, headers=headers)
    assert resp.status_code == 404
    assert "Message not found in parent thread" in resp.json()["detail"]

    # --- Test Branching: Success case ---
    resp = client.post("/chat/threads/branch", json=branch_payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "success"}

    # Verify new thread has correct persona and history (copied up to message 2)
    with get_db_session() as session:
        new_conv = session.query(Conversation).filter_by(id=new_id).first()
        assert new_conv is not None
        assert new_conv.title == "Branched Thread"
        assert new_conv.agent == "teacher" # Agent copied

        new_exps = session.query(Experience).filter_by(conversation_id=new_id).order_by(Experience.created_at).all()
        assert len(new_exps) == 2 # exp1 and exp2
        assert new_exps[0].user_query == "Query 1"
        assert new_exps[1].user_query == "Query 2"

    # --- Test Truncating: 404 non-existent message ---
    invalid_trunc_payload = {"upto_message_id": "usr-non-existent-msg"}
    resp = client.post(f"/chat/threads/{parent_id}/truncate", json=invalid_trunc_payload, headers=headers)
    assert resp.status_code == 404
    assert "Message not found in thread" in resp.json()["detail"]

    # --- Test Truncating: Success case ---
    # truncate parent_id from exp2 (which removes exp2 and exp3)
    resp = client.post(f"/chat/threads/{parent_id}/truncate", json=truncate_payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "success"}

    # Verify parent_id now only contains exp1
    with get_db_session() as session:
        remaining_exps = session.query(Experience).filter_by(conversation_id=parent_id).order_by(Experience.created_at).all()
        assert len(remaining_exps) == 1
        assert str(remaining_exps[0].id) == exp_id1

        # Clean database
        session.query(Experience).filter(Experience.conversation_id.in_([parent_id, new_id])).delete(synchronize_session=False)
        session.query(Conversation).filter(Conversation.id.in_([parent_id, new_id])).delete(synchronize_session=False)
        session.commit()



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
#    mock_start.assert_called_once()
#    mock_close.assert_called_once()


def test_conversation_pinning_endpoints(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    from fastapi.testclient import TestClient
    from agent.main import app
    from db.session import get_db_session
    from db.client import DBClient

    client = TestClient(app)
    headers = {"Authorization": "Bearer secret-test-key"}

    # 1. Create a thread directly in db first so we have a valid conversation ID to patch
    with get_db_session() as session:
        db_client = DBClient(session)
        conv = db_client.create_client_conversation(title="Test Pinned Thread")
        thread_id = conv.id
        session.commit()

    # 2. Check get threads has is_pinned=False
    resp = client.get("/chat/threads", headers=headers)
    assert resp.status_code == 200
    threads = resp.json()
    my_thread = next((t for t in threads if t["id"] == thread_id), None)
    assert my_thread is not None
    assert my_thread["is_pinned"] is False

    # 3. Patch the thread to be pinned
    patch_resp = client.patch(f"/chat/threads/{thread_id}", json={"is_pinned": True}, headers=headers)
    assert patch_resp.status_code == 200
    assert patch_resp.json()["status"] == "success"
    assert patch_resp.json()["is_pinned"] is True

    # 4. Check get threads has is_pinned=True
    resp = client.get("/chat/threads", headers=headers)
    assert resp.status_code == 200
    threads = resp.json()
    my_thread = next((t for t in threads if t["id"] == thread_id), None)
    assert my_thread["is_pinned"] is True

    # 5. Patch title and check
    patch_resp = client.patch(f"/chat/threads/{thread_id}", json={"title": "Updated Title via Patch"}, headers=headers)
    assert patch_resp.status_code == 200
    assert patch_resp.json()["title"] == "Updated Title via Patch"

    # 6. Unpin client-side and check database updates
    patch_resp = client.patch(f"/chat/threads/{thread_id}", json={"is_pinned": False}, headers=headers)
    assert patch_resp.status_code == 200
    assert patch_resp.json()["is_pinned"] is False


def test_truncate_thread_updates_updated_at(monkeypatch):
    import uuid
    from datetime import datetime, UTC, timedelta
    from db.session import get_db_session
    from db.models import Conversation, Experience
    from fastapi.testclient import TestClient
    from agent.main import app

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}
    client = TestClient(app)

    thread_id = str(uuid.uuid4())
    exp_id1 = str(uuid.uuid4())
    exp_id2 = str(uuid.uuid4())

    # 1. Set conversation experiences DB
    with get_db_session() as session:
        conv = Conversation(id=thread_id, title="Test Truncate Thread", agent="personal assistant")
        # Set updated_at to past
        past_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        conv.updated_at = past_time
        session.add(conv)
        session.flush()

        exp1 = Experience(
            id=exp_id1,
            conversation_id=thread_id,
            user_query="Q1",
            agent_response="R1",
            created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=5)
        )
        exp2 = Experience(
            id=exp_id2,
            conversation_id=thread_id,
            user_query="Q2",
            agent_response="R2",
            created_at=datetime.now(UTC).replace(tzinfo=None)
        )
        session.add_all([exp1, exp2])
        session.commit()

    # 2. Call endpoint using TestClient
    payload = {"upto_message_id": f"usr-{exp_id2}"}
    resp = client.post(f"/chat/threads/{thread_id}/truncate", json=payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "success"}

    # 3. Verify database exp2 deleted, exp1 remains, updated_at updated
    with get_db_session() as session:
        remaining = session.query(Experience).filter_by(conversation_id=thread_id).all()
        assert len(remaining) == 1
        assert remaining[0].id == exp_id1

        # Check conversation updated_at
        conv_db = session.query(Conversation).filter_by(id=thread_id).first()
        assert conv_db.updated_at != past_time
        assert (datetime.now(UTC).replace(tzinfo=None) - conv_db.updated_at).total_seconds() < 5

    # Clean database
    with get_db_session() as session:
        session.query(Experience).filter_by(conversation_id=thread_id).delete(synchronize_session=False)
        session.query(Conversation).filter_by(id=thread_id).delete(synchronize_session=False)
        session.commit()


def test_truncate_thread_invalid_cases(monkeypatch):
    import uuid
    from db.session import get_db_session
    from db.models import Conversation
    from fastapi.testclient import TestClient
    from agent.main import app

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}
    
    # 1. Non-existent thread/conversation
    with TestClient(app) as client:
        payload = {"upto_message_id": f"usr-{uuid.uuid4()}"}
        resp = client.post(f"/chat/threads/non-existent-thread-id/truncate", json=payload, headers=headers)
        assert resp.status_code == 404
        assert "Message not found in thread" in resp.json()["detail"]
        
    # 2. Existing thread but non-existent message ID
    thread_id = str(uuid.uuid4())
    with get_db_session() as session:
        conv = Conversation(id=thread_id, title="Test Truncate Errors", agent="personal assistant")
        session.add(conv)
        session.commit()
        
    with TestClient(app) as client:
        payload = {"upto_message_id": f"usr-{uuid.uuid4()}"}
        resp = client.post(f"/chat/threads/{thread_id}/truncate", json=payload, headers=headers)
        assert resp.status_code == 404
        assert "Message not found in thread" in resp.json()["detail"]
        
    # Clean up
    with get_db_session() as session:
        session.query(Conversation).filter_by(id=thread_id).delete(synchronize_session=False)
        session.commit()


def test_register_device_token_endpoint(monkeypatch):
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}
    client = TestClient(app)

    payload = {"token": "fcm-test-token-123456"}
    resp = client.post("/api/config/device-token", json=payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "success", "message": "FCM device token registered"}

    # Verify storage in DB
    from db.database import PostgresDB
    db_client = PostgresDB()
    stored_token = db_client.get_system_setting("fcm_device_token")
    assert stored_token == "fcm-test-token-123456"

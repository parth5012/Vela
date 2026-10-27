import pytest
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

    # 5. Test get personas list endpoint (dynamic: derived from the registry,
    # so registering a new agent never requires a hardcoded count update)
    from agent.registry import AGENT_REGISTRY

    resp_personas = client.get("/chat/personas", headers=headers)
    assert resp_personas.status_code == 200
    personas = resp_personas.json()
    expected_ids = {config.identifier for config in AGENT_REGISTRY.list_agents()}
    persona_ids = {p["id"] for p in personas}
    assert persona_ids == expected_ids
    # Core chat personas must always be present
    assert {"personal assistant", "teacher", "analyst", "prompt builder"} <= persona_ids



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


@pytest.mark.asyncio
async def test_lifespan_schema_migration_rename_persona():
    """Test lifespan DB migration renames legacy persona column to agent."""
    from agent.main import lifespan, app
    from unittest.mock import MagicMock, patch

    mock_engine = MagicMock()
    mock_inspector = MagicMock()

    # Case 1: 'persona' column present, 'agent' column absent
    mock_inspector.get_columns.return_value = [{"name": "persona"}, {"name": "id"}]
    mock_conn = MagicMock()
    mock_engine.begin.return_value.__enter__.return_value = mock_conn

    with patch("db.session.engine", mock_engine), patch(
        "sqlalchemy.inspect", return_value=mock_inspector
    ):
        async with lifespan(app):
            pass

    # Verify RENAME COLUMN persona TO agent statement executed
    calls = [str(call[0][0]) for call in mock_conn.execute.call_args_list]
    assert any("RENAME COLUMN persona TO agent" in call for call in calls)


@pytest.mark.asyncio
async def test_lifespan_schema_migration_add_missing_columns():
    """Test lifespan DB migration adds agent, active_skill, is_pinned, source if missing."""
    from agent.main import lifespan, app
    from unittest.mock import MagicMock, patch

    mock_engine = MagicMock()
    mock_inspector = MagicMock()

    # Case 2: Neither 'persona' nor 'agent' present, missing active_skill, is_pinned, source
    mock_inspector.get_columns.return_value = [{"name": "id"}]
    mock_conn = MagicMock()
    mock_engine.begin.return_value.__enter__.return_value = mock_conn

    with patch("db.session.engine", mock_engine), patch(
        "sqlalchemy.inspect", return_value=mock_inspector
    ):
        async with lifespan(app):
            pass

    calls = [str(call[0][0]) for call in mock_conn.execute.call_args_list]
    assert any("ADD COLUMN agent" in call for call in calls)
    assert any("ADD COLUMN active_skill" in call for call in calls)
    assert any("ADD COLUMN is_pinned" in call for call in calls)
    assert any("ADD COLUMN source" in call for call in calls)


def test_message_payload_validation():
    """Test MessagePayload default agent, persona alias, and explicit agent setting."""
    from agent.main import MessagePayload

    # 1. Default agent
    p1 = MessagePayload(thread_id="t1", message="hello")
    assert p1.agent == "personal assistant"

    # 2. Persona alias
    p2 = MessagePayload.model_validate({"thread_id": "t2", "message": "hi", "persona": "teacher"})
    assert p2.agent == "teacher"

    # 3. Explicit agent
    p3 = MessagePayload(thread_id="t3", message="analyze", agent="analyst")
    assert p3.agent == "analyst"

    # 4. Google workspace agent
    p4 = MessagePayload(thread_id="t4", message="check mail", agent="google_workspace")
    assert p4.agent == "google_workspace"


def test_eval_thread_bypasses_experience_persistence(monkeypatch):
    """Verify that /chat/message with eval- thread prefix bypasses Experience DB writes."""
    from fastapi.testclient import TestClient
    from agent.main import app, _EVAL_THREAD_HISTORY, clear_eval_thread_history
    from db.client import DBClient
    from unittest.mock import patch, MagicMock

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}
    client = TestClient(app)

    eval_thread_id = "eval-thread-no-poison-999"
    clear_eval_thread_history(eval_thread_id)

    with patch.object(DBClient, "save_experience") as mock_save:
        async def mock_events(*args, **kwargs):
            chunk = MagicMock()
            chunk.content = "Evaluated response content."
            yield {"event": "on_chat_model_stream", "data": {"chunk": chunk}}

        with patch("agent.main.graph.astream_events", side_effect=mock_events):
            resp = client.post(
                "/chat/message",
                json={"thread_id": eval_thread_id, "message": "Secret anchor fact"},
                headers=headers,
            )
            assert resp.status_code == 200
            mock_save.assert_not_called()

            # Verify eval memory retention in eval-only store
            assert eval_thread_id in _EVAL_THREAD_HISTORY
            history = _EVAL_THREAD_HISTORY[eval_thread_id]
            assert len(history) == 2
            assert history[0].content == "Secret anchor fact"
            assert "Evaluated response content." in history[1].content

    clear_eval_thread_history(eval_thread_id)


@pytest.mark.asyncio
async def test_stop_thread_cancels_stream_releases_semaphore_and_persists_partial(monkeypatch):
    import asyncio
    import uuid

    from httpx import ASGITransport, AsyncClient
    from langchain_core.messages import AIMessageChunk

    import agent.main as m
    from agent import concurrency
    from db.client import DBClient
    from db.models import Conversation, Experience
    from db.session import get_db_session

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    concurrency._semaphore = None
    sem = concurrency.get_stream_semaphore()
    limit = sem._value

    thread_id = f"test-stop-{uuid.uuid4()}"
    norm_id = m.normalize_thread_id(thread_id)

    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="Stop Endpoint Test",
            agent="personal assistant",
            conversation_id=norm_id,
            source="android_client",
        )

    producer_started = asyncio.Event()
    producer_cancelled = asyncio.Event()

    async def slow_stream(*args, **kwargs):
        try:
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="partial text stream ")},
            }
            producer_started.set()
            await asyncio.sleep(10)
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="should not be reached")},
            }
        except asyncio.CancelledError:
            producer_cancelled.set()
            raise

    try:
        async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
            # 1. Verify auth enforcement on /stop endpoint
            resp_no_auth = await client.post(f"/chat/threads/{thread_id}/stop")
            assert resp_no_auth.status_code == 403

            resp_bad_auth = await client.post(
                f"/chat/threads/{thread_id}/stop",
                headers={"Authorization": "Bearer bad-key"},
            )
            assert resp_bad_auth.status_code == 401

            # 2. Idle stop when no stream is running
            resp_idle = await client.post(f"/chat/threads/{thread_id}/stop", headers=headers)
            assert resp_idle.status_code == 200
            assert resp_idle.json() == {"status": "idle", "thread_id": thread_id}

            # 3. Start streaming with slow_stream
            stream_received = []

            async def consume_stream():
                async with client.stream(
                    "POST",
                    "/chat/message",
                    json={"thread_id": thread_id, "message": "hello stop test", "agent": "personal assistant"},
                    headers=headers,
                ) as resp:
                    assert resp.status_code == 200
                    async for line in resp.aiter_lines():
                        if line:
                            stream_received.append(line)

            with patch.object(m.graph, "astream_events", side_effect=slow_stream):
                stream_task = asyncio.create_task(consume_stream())

                # Wait for producer to start and yield the first token
                await asyncio.wait_for(producer_started.wait(), timeout=5.0)

                # Concurrency semaphore acquired during streaming
                assert sem._value < limit

                # 4. Call /stop endpoint
                resp_stop = await client.post(f"/chat/threads/{thread_id}/stop", headers=headers)
                assert resp_stop.status_code == 200
                assert resp_stop.json() == {"status": "stopped", "thread_id": thread_id}

                # 5. Verify producer cancelled and stream task finished
                await asyncio.wait_for(stream_task, timeout=5.0)
                assert producer_cancelled.is_set()

                # Semaphore released
                assert sem._value == limit

                # Verify partial text persisted to DB
                with get_db_session() as session:
                    exps = session.query(Experience).filter_by(conversation_id=norm_id).all()
                    assert len(exps) == 1
                    assert "partial text stream" in (exps[0].agent_response or "")
                    assert "should not be reached" not in (exps[0].agent_response or "")

                # 6. Verify calling /stop again returns idle
                resp_idle_again = await client.post(f"/chat/threads/{thread_id}/stop", headers=headers)
                assert resp_idle_again.status_code == 200
                assert resp_idle_again.json() == {"status": "idle", "thread_id": thread_id}
    finally:
        for t in list(m.BACKGROUND_TASKS):
            if not t.done():
                t.cancel()
        concurrency._semaphore = None
        with get_db_session() as session:
            from db.models import SyncMessage
            session.query(SyncMessage).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Experience).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Conversation).filter_by(id=norm_id).delete(synchronize_session=False)


@pytest.mark.asyncio
async def test_passive_disconnect_preserves_background_producer_and_stop_cancels(monkeypatch):
    """Preserve commit 481a466a intent: passive disconnect keeps background producer running,
    and a subsequent POST /chat/threads/{id}/stop still finds the turn in ACTIVE_STREAM_TASKS
    and cancels it.
    """
    import asyncio
    import uuid

    from httpx import ASGITransport, AsyncClient
    from langchain_core.messages import AIMessageChunk

    import agent.main as m
    from agent import concurrency
    from db.client import DBClient
    from db.models import Conversation, Experience, SyncMessage
    from db.session import get_db_session

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    concurrency._semaphore = None
    sem = concurrency.get_stream_semaphore()
    limit = sem._value

    thread_id = f"test-disc-stop-{uuid.uuid4()}"
    norm_id = m.normalize_thread_id(thread_id)

    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="Disconnect Then Stop Test",
            agent="personal assistant",
            conversation_id=norm_id,
            source="android_client",
        )

    producer_started = asyncio.Event()
    producer_cancelled = asyncio.Event()

    async def slow_stream(*args, **kwargs):
        try:
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="chunk before disconnect ")},
            }
            producer_started.set()
            await asyncio.sleep(10)
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="should not be reached")},
            }
        except asyncio.CancelledError:
            producer_cancelled.set()
            raise

    try:
        with patch.object(m.graph, "astream_events", side_effect=slow_stream):
            resp = await m.chat_message(
                m.MessagePayload(thread_id=thread_id, message="hello disconnect stop", agent="personal assistant")
            )
            it = resp.body_iterator
            first = await it.__anext__()
            assert "chunk before disconnect" in first
            await producer_started.wait()

            # Passive client disconnect: simulate client dropping the SSE generator
            await it.aclose()
            await asyncio.sleep(0.1)

            # Commit 481a466a preservation: producer task continues running in background
            assert not producer_cancelled.is_set()
            assert norm_id in m.ACTIVE_STREAM_TASKS
            assert not m.ACTIVE_STREAM_TASKS[norm_id].done()

            # Subsequent POST /chat/threads/{id}/stop finds the active turn and cancels it
            async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
                stop_resp = await client.post(f"/chat/threads/{thread_id}/stop", headers=headers)
                assert stop_resp.status_code == 200
                assert stop_resp.json() == {"status": "stopped", "thread_id": thread_id}

            await asyncio.wait_for(producer_cancelled.wait(), timeout=5.0)
            assert producer_cancelled.is_set()

            # Semaphore is released
            assert sem._value == limit

            # Subsequent stop returns idle
            async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
                idle_resp = await client.post(f"/chat/threads/{thread_id}/stop", headers=headers)
                assert idle_resp.status_code == 200
                assert idle_resp.json() == {"status": "idle", "thread_id": thread_id}
    finally:
        for t in list(m.BACKGROUND_TASKS):
            if not t.done():
                t.cancel()
        concurrency._semaphore = None
        with get_db_session() as session:
            session.query(SyncMessage).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Experience).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Conversation).filter_by(id=norm_id).delete(synchronize_session=False)


@pytest.mark.asyncio
async def test_stop_thread_generation_scoping(monkeypatch):
    """Test stream_generation scoping on /chat/message and /stop:
    - mismatch returns status: idle and leaves active stream running
    - match cancels the active stream
    - conflicting stream_generation values return 400
    """
    import asyncio
    import uuid
    from unittest.mock import patch

    from httpx import ASGITransport, AsyncClient
    from langchain_core.messages import AIMessageChunk

    import agent.main as m
    from agent import concurrency
    from db.client import DBClient
    from db.models import Conversation, Experience, SyncMessage
    from db.session import get_db_session

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    concurrency._semaphore = None
    thread_id = f"test-gen-stop-{uuid.uuid4()}"
    norm_id = m.normalize_thread_id(thread_id)

    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="Gen Scoping Test",
            agent="personal assistant",
            conversation_id=norm_id,
            source="android_client",
        )

    producer_started = asyncio.Event()
    producer_cancelled = asyncio.Event()

    async def slow_stream(*args, **kwargs):
        try:
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="gen test stream ")},
            }
            producer_started.set()
            await asyncio.sleep(10)
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="should not be reached")},
            }
        except asyncio.CancelledError:
            producer_cancelled.set()
            raise

    try:
        async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
            # Check conflicting payload returns 400
            resp_conflict = await client.post(
                f"/chat/threads/{thread_id}/stop",
                json={"stream_generation": 1, "streamGeneration": 2},
                headers=headers,
            )
            assert resp_conflict.status_code == 400

            stream_received = []

            async def consume_stream():
                async with client.stream(
                    "POST",
                    "/chat/message",
                    json={
                        "thread_id": thread_id,
                        "message": "hello generation test",
                        "agent": "personal assistant",
                        "stream_generation": 1,
                    },
                    headers=headers,
                ) as resp:
                    assert resp.status_code == 200
                    async for line in resp.aiter_lines():
                        if line:
                            stream_received.append(line)

            with patch.object(m.graph, "astream_events", side_effect=slow_stream):
                stream_task = asyncio.create_task(consume_stream())
                await asyncio.wait_for(producer_started.wait(), timeout=5.0)

                # Stop with mismatching generation (2 != 1) -> idle, stream continues
                resp_mismatch = await client.post(
                    f"/chat/threads/{thread_id}/stop",
                    json={"stream_generation": 2},
                    headers=headers,
                )
                assert resp_mismatch.status_code == 200
                assert resp_mismatch.json() == {"status": "idle", "thread_id": thread_id}
                assert not producer_cancelled.is_set()
                assert not stream_task.done()

                # Stop with matching generation (1 == 1) -> stopped
                resp_match = await client.post(
                    f"/chat/threads/{thread_id}/stop",
                    json={"stream_generation": 1},
                    headers=headers,
                )
                assert resp_match.status_code == 200
                assert resp_match.json() == {"status": "stopped", "thread_id": thread_id}

                await asyncio.wait_for(stream_task, timeout=5.0)
                assert producer_cancelled.is_set()
    finally:
        for t in list(m.BACKGROUND_TASKS):
            if not t.done():
                t.cancel()
        concurrency._semaphore = None
        with get_db_session() as session:
            session.query(SyncMessage).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Experience).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Conversation).filter_by(id=norm_id).delete(synchronize_session=False)


@pytest.mark.asyncio
async def test_stop_thread_backlog_tail_persisted_and_sse_stopped_event(monkeypatch):
    """Test backlog tail persistence and SSE event contract:
    - Producer queues multiple chunks before blocking.
    - /stop cancels producer.
    - All queued chunks are streamed and persisted in Experience.agent_response.
    - SSE stream yields type: thread_stopped and NO type: done or title event.
    """
    import asyncio
    import json
    import uuid
    from unittest.mock import patch

    from httpx import ASGITransport, AsyncClient
    from langchain_core.messages import AIMessageChunk

    import agent.main as m
    from agent import concurrency
    from db.client import DBClient
    from db.models import Conversation, Experience, SyncMessage
    from db.session import get_db_session

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    concurrency._semaphore = None
    thread_id = f"test-backlog-{uuid.uuid4()}"
    norm_id = m.normalize_thread_id(thread_id)

    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="New Chat",
            agent="personal assistant",
            conversation_id=norm_id,
            source="android_client",
        )

    chunks_queued = asyncio.Event()
    producer_cancelled = asyncio.Event()

    async def fast_then_slow_stream(*args, **kwargs):
        try:
            # Yield several chunks quickly into the queue
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="chunk_alpha ")},
            }
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="chunk_beta ")},
            }
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="chunk_gamma ")},
            }
            chunks_queued.set()
            await asyncio.sleep(10)
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="should_never_reach")},
            }
        except asyncio.CancelledError:
            producer_cancelled.set()
            raise

    try:
        async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
            stream_received = []

            async def consume_stream():
                async with client.stream(
                    "POST",
                    "/chat/message",
                    json={"thread_id": thread_id, "message": "hello backlog", "agent": "personal assistant"},
                    headers=headers,
                ) as resp:
                    assert resp.status_code == 200
                    async for line in resp.aiter_lines():
                        if line:
                            stream_received.append(line)

            with patch.object(m.graph, "astream_events", side_effect=fast_then_slow_stream):
                stream_task = asyncio.create_task(consume_stream())

                # Wait until producer has queued all 3 chunks
                await asyncio.wait_for(chunks_queued.wait(), timeout=5.0)
                await asyncio.sleep(0.05)

                # Stop the thread
                resp_stop = await client.post(f"/chat/threads/{thread_id}/stop", headers=headers)
                assert resp_stop.status_code == 200
                assert resp_stop.json() == {"status": "stopped", "thread_id": thread_id}

                await asyncio.wait_for(stream_task, timeout=5.0)
                assert producer_cancelled.is_set()

                # Verify SSE lines: should contain thread_stopped event and NOT done event
                parsed_events = []
                for line in stream_received:
                    if line.startswith("data: "):
                        parsed_events.append(json.loads(line[6:].strip()))

                types = [ev.get("type") for ev in parsed_events]
                assert "thread_stopped" in types
                assert "done" not in types

                stopped_event = next(ev for ev in parsed_events if ev.get("type") == "thread_stopped")
                assert stopped_event.get("thread_id") == thread_id

                # Verify DB persistence includes ALL queued chunks in agent_response
                with get_db_session() as session:
                    exps = session.query(Experience).filter_by(conversation_id=norm_id).all()
                    assert len(exps) == 1
                    saved_text = exps[0].agent_response or ""
                    assert "chunk_alpha " in saved_text
                    assert "chunk_beta " in saved_text
                    assert "chunk_gamma " in saved_text
                    assert "should_never_reach" not in saved_text
    finally:
        for t in list(m.BACKGROUND_TASKS):
            if not t.done():
                t.cancel()
        concurrency._semaphore = None
        with get_db_session() as session:
            session.query(SyncMessage).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Experience).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Conversation).filter_by(id=norm_id).delete(synchronize_session=False)


@pytest.mark.asyncio
async def test_delete_thread_cancels_running_producer_and_avoids_fk_error(monkeypatch):
    """Test DELETE /chat/threads/{thread_id} with active stream:
    - Cancels running producer task.
    - Deletes conversation and cascades.
    - No FK IntegrityError is raised when finalize/persist runs on deleted conversation.
    """
    import asyncio
    import uuid
    from unittest.mock import patch

    from httpx import ASGITransport, AsyncClient
    from langchain_core.messages import AIMessageChunk

    import agent.main as m
    from agent import concurrency
    from db.client import DBClient
    from db.models import Conversation, Experience, SyncMessage
    from db.session import get_db_session

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    concurrency._semaphore = None
    thread_id = f"test-del-stream-{uuid.uuid4()}"
    norm_id = m.normalize_thread_id(thread_id)

    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="Delete Active Stream Test",
            agent="personal assistant",
            conversation_id=norm_id,
            source="android_client",
        )

    producer_started = asyncio.Event()
    producer_cancelled = asyncio.Event()

    async def slow_stream(*args, **kwargs):
        try:
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="delete test stream ")},
            }
            producer_started.set()
            await asyncio.sleep(10)
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="should not be reached")},
            }
        except asyncio.CancelledError:
            producer_cancelled.set()
            raise

    try:
        async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
            stream_received = []

            async def consume_stream():
                async with client.stream(
                    "POST",
                    "/chat/message",
                    json={"thread_id": thread_id, "message": "hello delete test", "agent": "personal assistant"},
                    headers=headers,
                ) as resp:
                    assert resp.status_code == 200
                    async for line in resp.aiter_lines():
                        if line:
                            stream_received.append(line)

            with patch.object(m.graph, "astream_events", side_effect=slow_stream):
                stream_task = asyncio.create_task(consume_stream())
                await asyncio.wait_for(producer_started.wait(), timeout=5.0)

                assert norm_id in m.ACTIVE_STREAM_TASKS

                # Call DELETE /chat/threads/{thread_id}
                del_resp = await client.delete(f"/chat/threads/{thread_id}", headers=headers)
                assert del_resp.status_code == 200
                assert del_resp.json() == {"status": "success"}

                # Producer should be cancelled and stream should terminate cleanly
                await asyncio.wait_for(producer_cancelled.wait(), timeout=5.0)
                await asyncio.wait_for(stream_task, timeout=5.0)

                # Thread should be deleted from DB
                with get_db_session() as session:
                    conv = session.query(Conversation).filter_by(id=norm_id).first()
                    assert conv is None
    finally:
        for t in list(m.BACKGROUND_TASKS):
            if not t.done():
                t.cancel()
        concurrency._semaphore = None
        with get_db_session() as session:
            session.query(SyncMessage).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Experience).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
            session.query(Conversation).filter_by(id=norm_id).delete(synchronize_session=False)



@pytest.mark.asyncio
async def test_overlapping_message_cancels_previous_turn_and_frees_slot(monkeypatch):
    """CodeRabbit CR1 (PR #486): a second /chat/message on the same thread must
    cancel the first turn's producer — otherwise the first turn is unregistered
    (last-wins overwrite) and can never be stopped, leaking its semaphore slot.
    """
    import asyncio
    import uuid
    from unittest.mock import patch

    from httpx import ASGITransport, AsyncClient
    from langchain_core.messages import AIMessageChunk

    import agent.main as m
    from agent import concurrency
    from db.client import DBClient
    from db.session import get_db_session

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    concurrency._semaphore = None
    sem = concurrency.get_stream_semaphore()
    limit = sem._value

    thread_id = f"test-overlap-{uuid.uuid4()}"
    norm_id = m.normalize_thread_id(thread_id)

    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="Overlapping Start Test",
            agent="personal assistant",
            conversation_id=norm_id,
            source="android_client",
        )

    first_started = asyncio.Event()
    first_cancelled = asyncio.Event()
    call_index = 0

    async def per_call_stream(*args, **kwargs):
        nonlocal call_index
        call_index += 1
        this_call = call_index
        try:
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content=f"call{this_call} ")},
            }
            if this_call == 1:
                first_started.set()
                # First call blocks forever until cancelled by the overlap fix
                await asyncio.sleep(30)
                yield {
                    "event": "on_chat_model_stream",
                    "metadata": {"langgraph_node": "chatbot"},
                    "data": {"chunk": AIMessageChunk(content="never")},
                }
        except asyncio.CancelledError:
            if this_call == 1:
                first_cancelled.set()
            raise

    try:
        async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
            with patch.object(m.graph, "astream_events", side_effect=per_call_stream):

                async def consume_stream():
                    async with client.stream(
                        "POST",
                        "/chat/message",
                        json={"thread_id": thread_id, "message": "overlap", "agent": "personal assistant"},
                        headers=headers,
                    ) as resp:
                        assert resp.status_code == 200
                        async for _line in resp.aiter_lines():
                            pass

                task1 = asyncio.create_task(consume_stream())
                await asyncio.wait_for(first_started.wait(), timeout=5.0)

                task2 = asyncio.create_task(consume_stream())

                # The second registration must cancel the first producer.
                await asyncio.wait_for(first_cancelled.wait(), timeout=5.0)

                await asyncio.wait_for(
                    asyncio.gather(task1, task2, return_exceptions=True), timeout=10.0
                )

        # Both turns released their semaphore slots.
        assert sem._value == limit
    finally:
        m.ACTIVE_STREAM_TASKS.clear()


@pytest.mark.asyncio
async def test_stop_endpoint_awaits_inflight_persist_write(monkeypatch):
    """CodeRabbit CR2 (PR #486): the persisted flag means 'persist started', not
    'persist finished'. /stop must not return before the shielded DB write has
    completed — a client GETting the thread right after stop would read an empty
    agent_response.
    """
    import asyncio
    import threading
    import uuid

    from httpx import ASGITransport, AsyncClient
    from langchain_core.messages import AIMessageChunk

    import agent.main as m
    from db.client import DBClient
    from db.session import get_db_session

    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    thread_id = f"test-persist-wait-{uuid.uuid4()}"
    norm_id = m.normalize_thread_id(thread_id)

    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="Persist Wait Test",
            agent="personal assistant",
            conversation_id=norm_id,
            source="android_client",
        )

    producer_started = asyncio.Event()
    write_started = threading.Event()
    write_finished = threading.Event()

    real_persist = m._persist_sse_turn_sync

    def tracked_persist(*args, **kwargs):
        write_started.set()
        import time

        time.sleep(0.3)
        result = real_persist(*args, **kwargs)
        write_finished.set()
        return result

    async def slow_stream(*args, **kwargs):
        try:
            yield {
                "event": "on_chat_model_stream",
                "metadata": {"langgraph_node": "chatbot"},
                "data": {"chunk": AIMessageChunk(content="persist wait stream ")},
            }
            producer_started.set()
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            raise

    try:
        async with AsyncClient(transport=ASGITransport(app=m.app), base_url="http://test") as client:
            with (
                patch.object(m, "_persist_sse_turn_sync", side_effect=tracked_persist),
                patch.object(m.graph, "astream_events", side_effect=slow_stream),
            ):
                async def consume_stream():
                    async with client.stream(
                        "POST",
                        "/chat/message",
                        json={"thread_id": thread_id, "message": "persist wait", "agent": "personal assistant"},
                        headers=headers,
                    ) as resp:
                        assert resp.status_code == 200
                        async for _line in resp.aiter_lines():
                            pass

                stream_task = asyncio.create_task(consume_stream())
                await asyncio.wait_for(producer_started.wait(), timeout=5.0)

                resp_stop = await client.post(f"/chat/threads/{thread_id}/stop", headers=headers)
                assert resp_stop.status_code == 200
                assert resp_stop.json() == {"status": "stopped", "thread_id": thread_id}

                # The stop response must not precede the DB write that the
                # consumer kicked off.
                assert write_finished.is_set(), "/stop returned before the in-flight persist finished"

                await asyncio.wait_for(stream_task, timeout=5.0)
    finally:
        m.ACTIVE_STREAM_TASKS.clear()

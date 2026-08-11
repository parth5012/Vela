# 2026-07-04 Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement static token authentication and conversation CRUD / streaming SSE endpoints on the FastAPI server to support custom clients.

**Architecture:** Create an authorization dependency using `HTTPBearer` that secures all `/chat/*` endpoints. Extend the database client with SQLAlchemy mappings to handle client threads and mapped experience histories. Run LangGraph via `astream_events` inside a `StreamingResponse` to stream tokens.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, PostgreSQL, LangGraph, pytest.

---

### Task 1: SQL Schema Update

**Files:**
- Modify: `db/schema.sql`
- Test: `tests/test_db.py`

- [ ] **Step 1: Write the failing test**

Add this test function to `tests/test_db.py` to assert that the `title` column exists on the `conversations` table.

```python
def test_conversations_table_has_title_column():
    from db.session import get_db_session
    from sqlalchemy import text
    with get_db_session() as session:
        result = session.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='conversations' AND column_name='title';"
        )).fetchone()
        assert result is not None, "Conversations table is missing 'title' column"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_db.py::test_conversations_table_has_title_column -v`
Expected: FAIL (AssertionError: Conversations table is missing 'title' column)

- [ ] **Step 3: Write minimal implementation**

Execute the migration SQL statement in your database editor (e.g., Supabase SQL console) or append it directly to `db/schema.sql` if running fresh migrations:

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'New Chat';
```

*(Also, modify `db/models.py` to add the `title` attribute to the `Conversation` model class mapping)*

In `db/models.py`:
```python
# Add column definition inside class Conversation(Base):
title = Column(String(255), default="New Chat")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_db.py::test_conversations_table_has_title_column -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql db/models.py tests/test_db.py
git commit -m "db: add title column to conversations table"
```

---

### Task 2: Database Client CRUD Helpers

**Files:**
- Modify: `db/client.py`
- Test: `tests/test_client.py`

- [ ] **Step 1: Write the failing test**

Add these test cases inside `tests/test_client.py`:

```python
def test_client_conversation_crud_operations():
    from db.session import get_db_session
    from db.client import DBClient
    with get_db_session() as session:
        client = DBClient(session)
        # 1. Create client-specific conversation
        conv = client.create_client_conversation(title="Test Math Topic")
        session.commit()
        assert conv.id is not None
        assert conv.title == "Test Math Topic"
        
        # 2. Retrieve client-specific conversations
        conversations = client.get_client_conversations()
        assert len(conversations) > 0
        assert conversations[0].id == conv.id
        
        # 3. Update conversation title
        updated_conv = client.update_conversation_title(conv.id, "Updated Math Topic")
        session.commit()
        assert updated_conv.title == "Updated Math Topic"
        
        # 4. Fetch history (experiences)
        client.save_experience(conversation_id=conv.id, user_query="1+1?", agent_response="2")
        session.commit()
        history = client.get_conversation_history(conv.id)
        assert len(history) == 1
        assert history[0].user_query == "1+1?"
        assert history[0].agent_response == "2"
        
        # 5. Delete conversation
        success = client.delete_conversation(conv.id)
        session.commit()
        assert success is True
        assert client.get_conversation_history(conv.id) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_client.py::test_client_conversation_crud_operations -v`
Expected: FAIL (AttributeError: 'DBClient' object has no attribute 'create_client_conversation')

- [ ] **Step 3: Write minimal implementation**

Add these methods inside `DBClient` in `db/client.py`:

```python
    def get_client_conversations(self) -> list[Conversation]:
        """Retrieves all conversations created by the mobile client (no external gateway ID)."""
        return self.session.query(Conversation).filter(
            Conversation.telegram_chat_id.is_(None),
            Conversation.discord_channel_id.is_(None)
        ).order_by(Conversation.updated_at.desc()).all()

    def create_client_conversation(self, title: str = "New Chat") -> Conversation:
        """Creates a new client conversation thread."""
        conv_id = str(uuid.uuid4())
        conv = Conversation(id=conv_id, title=title)
        self.session.add(conv)
        self.session.flush()
        return conv

    def update_conversation_title(self, conversation_id: str, title: str) -> Conversation | None:
        """Updates the title of a specific conversation."""
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            conv.title = title
            conv.updated_at = datetime.utcnow()
            self.session.flush()
        return conv

    def delete_conversation(self, conversation_id: str) -> bool:
        """Deletes a conversation. Cascades to experiences and oauth_tokens automatically."""
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            self.session.delete(conv)
            self.session.flush()
            return True
        return False

    def get_conversation_history(self, conversation_id: str) -> list[Experience]:
        """Fetches all experiences associated with a conversation ordered chronologically."""
        return self.session.query(Experience).filter_by(
            conversation_id=conversation_id
        ).order_by(Experience.created_at.asc()).all()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_client.py::test_client_conversation_crud_operations -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db/client.py tests/test_client.py
git commit -m "feat: add client thread CRUD database methods"
```

---

### Task 3: Authentication Guard

**Files:**
- Modify: `agent/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add these test cases in `tests/test_api.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_api.py::test_endpoints_require_api_key_auth -v`
Expected: FAIL (AssertionError: 200 == 403) *(Since /health does not require key yet)*

- [ ] **Step 3: Write minimal implementation**

Add the authentication dependency and update `/health` endpoint to require it inside `agent/main.py`:

```python
import os
from fastapi import Security, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

def verify_api_key(credentials: HTTPAuthorizationCredentials = Security(security)):
    expected_key = os.getenv("VELA_API_KEY")
    if not expected_key or expected_key.startswith("your_"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API Key is not configured on the server."
        )
    if credentials.credentials != expected_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key."
        )
    return credentials.credentials

# Modify health route
@app.get("/health", dependencies=[Depends(verify_api_key)])
def health_check():
    logger.info("Health check pinged")
    return {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_api.py::test_endpoints_require_api_key_auth -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/main.py tests/test_api.py
git commit -m "feat: add HTTPBearer verify_api_key auth middleware to /health"
```

---

### Task 4: Thread Management REST Endpoints

**Files:**
- Modify: `agent/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add this test function to `tests/test_api.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_api.py::test_conversation_rest_endpoints -v`
Expected: FAIL (HTTP 404 on /chat/threads)

- [ ] **Step 3: Write minimal implementation**

Implement the list, history, and delete endpoints in `agent/main.py`:

```python
from db.client import DBClient
from db.session import get_db_session

@app.get("/chat/threads", dependencies=[Depends(verify_api_key)])
def list_threads():
    try:
        with get_db_session() as session:
            client = DBClient(session)
            threads = client.get_client_conversations()
            return [
                {
                    "id": t.id,
                    "title": t.title,
                    "created_at": t.created_at.isoformat(),
                    "updated_at": t.updated_at.isoformat()
                }
                for t in threads
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/chat/threads/{thread_id}", dependencies=[Depends(verify_api_key)])
def get_thread_history(thread_id: str):
    try:
        with get_db_session() as session:
            client = DBClient(session)
            experiences = client.get_conversation_history(thread_id)
            messages = []
            for exp in experiences:
                messages.append({
                    "id": f"usr-{exp.id}",
                    "role": "user",
                    "content": exp.user_query,
                    "created_at": exp.created_at.isoformat()
                })
                messages.append({
                    "id": f"ast-{exp.id}",
                    "role": "assistant",
                    "content": exp.agent_response,
                    "created_at": exp.created_at.isoformat()
                })
            return messages
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/chat/threads/{thread_id}", dependencies=[Depends(verify_api_key)])
def delete_thread(thread_id: str):
    try:
        with get_db_session() as session:
            client = DBClient(session)
            success = client.delete_conversation(thread_id)
            if not success:
                raise HTTPException(status_code=404, detail="Thread not found")
            session.commit()
            return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_api.py::test_conversation_rest_endpoints -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/main.py tests/test_api.py
git commit -m "feat: implement conversation list, history, and delete endpoints"
```

---

### Task 5: Streaming Chat Endpoint (SSE)

**Files:**
- Modify: `agent/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add this test function to `tests/test_api.py`:

```python
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
        assert response.headers["content-type"] == "text/event-stream"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_api.py::test_streaming_chat_message -v`
Expected: FAIL (HTTP 404 on /chat/message)

- [ ] **Step 3: Write minimal implementation**

Implement the streaming endpoint in `agent/main.py`:

```python
import json
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from agent.graph import graph
from db.models import Conversation

class MessagePayload(BaseModel):
    thread_id: str
    message: str

@app.post("/chat/message", dependencies=[Depends(verify_api_key)])
async def chat_message(payload: MessagePayload):
    async def sse_generator():
        # Retrieve or create thread
        with get_db_session() as session:
            client = DBClient(session)
            conv = session.query(Conversation).filter_by(id=payload.thread_id).first()
            if not conv:
                conv = client.create_client_conversation()
                session.commit()
                thread_uuid = conv.id
            else:
                thread_uuid = conv.id

        initial_state = {
            "messages": [HumanMessage(content=payload.message)],
            "db_conv_id": thread_uuid,
            "next_node": "supervisor"
        }

        full_response = ""
        
        # Async generator looping over LangGraph events
        async for event in graph.astream_events(initial_state, version="v2"):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and chunk.content:
                    full_response += chunk.content
                    yield f"data: {json.dumps({'type': 'content', 'delta': chunk.content})}\n\n"

        # Generate a dynamic title if thread title is 'New Chat'
        if conv and conv.title == "New Chat":
            new_title = payload.message[:30] + "..." if len(payload.message) > 30 else payload.message
            with get_db_session() as session:
                client = DBClient(session)
                client.update_conversation_title(thread_uuid, new_title)
                session.commit()
            title_to_send = new_title
        else:
            title_to_send = conv.title if conv else "New Chat"

        # Send final completed event
        yield f"data: {json.dumps({'type': 'done', 'thread_title': title_to_send})}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_api.py::test_streaming_chat_message -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/main.py tests/test_api.py
git commit -m "feat: implement SSE POST /chat/message streaming agent response"
```

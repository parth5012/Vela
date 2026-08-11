# 2026-07-04 FastAPI Client Endpoints & Auth Design

This design specification details the requirements, endpoints, database changes, and LangGraph integration patterns for extending the FastAPI backend (`agent/main.py`) to support a custom client application.

---

## 1. Objectives & Security Architecture

### High-level Objectives:
1. **Dynamic Authentication:** Secure all chat client-related routes using a static API key token authorization model.
2. **Database Migration:** Support saving custom thread titles by adding a `title` column to the `conversations` table.
3. **Conversational CRUD:** Expose REST endpoints to manage conversations (create, delete, list) and fetch message histories.
4. **SSE Streaming Interface:** Integrate with LangGraph's workflow runner to parse and stream live response tokens back to the client over Server-Sent Events (SSE).

### Authentication Setup:
We will use FastAPI's built-in `HTTPBearer` security class to implement key validation:
*   A server environment variable `VELA_API_KEY` is loaded.
*   A security dependency function `verify_api_key` intercepts requests, extracts the bearer token, and validates it.
*   If the token matches `VELA_API_KEY`, the request proceeds. If not, it throws a `401 Unauthorized` exception.
*   A `404 Not Found` or `500 Internal Server Error` is returned if `VELA_API_KEY` is not configured in the `.env` file.

---

## 2. Database Schema Modifications (Option A)

To support named conversation threads, we need to alter the database schema to include a `title` column on the `conversations` table.

### Schema Migration SQL:
```sql
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'New Chat';
```
*Note: This SQL statement must be executed in the Supabase SQL editor or run as a startup migration.*

---

## 3. Database CRUD Helpers

We will add the following helper methods to `DBClient` in `db/client.py` to support client conversations:

### 1. Retrieve Client Conversations
```python
def get_client_conversations(self) -> list[Conversation]:
    """Retrieves all conversations created by the mobile client (no external gateway ID)."""
    return self.session.query(Conversation).filter(
        Conversation.telegram_chat_id.is_(None),
        Conversation.discord_channel_id.is_(None)
    ).order_by(Conversation.updated_at.desc()).all()
```

### 2. Create Client Conversation
```python
def create_client_conversation(self, title: str = "New Chat") -> Conversation:
    """Creates a new client conversation thread."""
    conv_id = str(uuid.uuid4())
    conv = Conversation(id=conv_id, title=title)
    self.session.add(conv)
    self.session.flush()
    return conv
```

### 3. Update Conversation Title
```python
def update_conversation_title(self, conversation_id: str, title: str) -> Conversation | None:
    """Updates the title of a specific conversation."""
    conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
    if conv:
        conv.title = title
        conv.updated_at = datetime.utcnow()
        self.session.flush()
    return conv
```

### 4. Delete Conversation Thread
```python
def delete_conversation(self, conversation_id: str) -> bool:
    """Deletes a conversation. Cascades to experiences and oauth_tokens automatically."""
    conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
    if conv:
        self.session.delete(conv)
        self.session.flush()
        return True
    return False
```

### 5. Fetch Message History
```python
def get_conversation_history(self, conversation_id: str) -> list[Experience]:
    """Fetches all experiences associated with a conversation ordered chronologically."""
    return self.session.query(Experience).filter_by(
        conversation_id=conversation_id
    ).order_by(Experience.created_at.asc()).all()
```

---

## 4. API Endpoints Implementation Specification

We will implement the following routes in `agent/main.py`:

### 4.1. Auth Dependency
```python
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
```

### 4.2. Health Verification
```python
@app.get("/health", dependencies=[Depends(verify_api_key)])
def health_check():
    return {"status": "ok"}
```

### 4.3. List Threads
```python
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
```

### 4.4. Get Thread History
```python
@app.get("/chat/threads/{thread_id}", dependencies=[Depends(verify_api_key)])
def get_thread_history(thread_id: str):
    try:
        with get_db_session() as session:
            client = DBClient(session)
            experiences = client.get_conversation_history(thread_id)
            
            # Map experiences back to individual message bubbles
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
```

### 4.5. Delete Thread
```python
@app.get("/chat/threads/{thread_id}/delete", dependencies=[Depends(verify_api_key)])
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

### 4.6. Send Message & Stream Response (SSE)
To stream LangGraph node outputs, we will use LangGraph's `.astream_events(..., version="v2")` engine:

```python
import json
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from agent.graph import graph

class MessagePayload(BaseModel):
    thread_id: str
    message: str

@app.post("/chat/message", dependencies=[Depends(verify_api_key)])
async def chat_message(payload: MessagePayload):
    async def sse_generator():
        # Check if conversation exists, create if not
        with get_db_session() as session:
            client = DBClient(session)
            conv = session.query(Conversation).filter_by(id=payload.thread_id).first()
            if not conv:
                conv = client.create_client_conversation()
                session.commit()
                # Store new UUID in a local variable for tracking
                thread_uuid = conv.id
            else:
                thread_uuid = conv.id

        initial_state = {
            "messages": [HumanMessage(content=payload.message)],
            "db_conv_id": thread_uuid,
            "next_node": "supervisor"
        }

        full_response = ""
        
        # Stream the graph execution events
        async for event in graph.astream_events(initial_state, version="v2"):
            kind = event.get("event")
            
            # Extract content stream from Chat Models (e.g. Gemini / Groq)
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and chunk.content:
                    full_response += chunk.content
                    yield f"data: {json.dumps({'type': 'content', 'delta': chunk.content})}\n\n"

        # Generate a thread title dynamically if it was named 'New Chat'
        new_title = None
        if conv and conv.title == "New Chat":
            new_title = payload.message[:30] + "..." if len(payload.message) > 30 else payload.message
            with get_db_session() as session:
                client = DBClient(session)
                client.update_conversation_title(thread_uuid, new_title)
                session.commit()

        # Send completion event
        yield f"data: {json.dumps({'type': 'done', 'thread_title': new_title or conv.title})}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")
```

---

## 5. Implementation Steps for the Developer Agent

The developer agent should follow this order:
1. **Schema Update:** Run SQL migration to add the `title` column to the `conversations` table.
2. **Database Client Extension:** Update `db/client.py` and `db/supabase.py` with the 5 CRUD helpers.
3. **Auth Dependency Setup:** Write `verify_api_key` and configure `.env` loading.
4. **FastAPI Endpoints:** Implement endpoints for `/health`, `/chat/threads`, and `/chat/message` (SSE handler).
5. **Testing Suite:** Add integration tests checking response status, authorization header guard, and stream decoding.

from agent.persona import PERSONA_LIST
from utils.llm import get_llm
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Query, responses, Request, BackgroundTasks, Security, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from google_auth_oauthlib.flow import Flow
from db.supabase import SupabaseDB
from gateway.telegram import TelegramGateway
from gateway.discord import DiscordGateway
from cron.consolidate import run_self_improvement
from utils.logger import StructuredLogger
from db.client import DBClient
from db.session import get_db_session
import json
import uuid
from pydantic import BaseModel

from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from agent.graph import graph
from db.models import Conversation, Experience



logger = StructuredLogger("VelaServer")
db = SupabaseDB()
telegram_gateway = TelegramGateway(db=db)
discord_gateway = DiscordGateway(db=db)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run database migration (add persona column if missing)
    try:
        from db.session import engine
        from sqlalchemy import inspect
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('conversations')]
        if 'persona' not in columns:
            logger.info("Database migration: adding 'persona' column to 'conversations' table")
            with engine.begin() as conn:
                conn.execute("ALTER TABLE conversations ADD COLUMN persona VARCHAR(50) DEFAULT 'personal assistant' NOT NULL")
    except Exception as e:
        logger.error("Failed to run database migration for persona column", error=str(e))

    yield

app = FastAPI(title="Vela Server", lifespan=lifespan)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events"
]

@app.get("/")
def health():
    logger.info("Health check pinged")
    return {"status": "ok"}

    
security = HTTPBearer(auto_error=False)

def verify_api_key(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authenticated"
        )
    expected_key = os.getenv("VELA_API_KEY","vela5012")
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

@app.get("/health", dependencies=[Depends(verify_api_key)])
def health_check():
    logger.info("Health check pinged")
    return {"status": "ok"}


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
                    "persona": t.persona,
                    "created_at": t.created_at.isoformat(),
                    "updated_at": t.updated_at.isoformat()
                }
                for t in threads
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/chat/personas", dependencies=[Depends(verify_api_key)])
def list_personas():
    return PERSONA_LIST


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



class TitlePayload(BaseModel):
    thread_id : str
    title: str

@app.post("/chat/threads/",dependencies=[Depends(verify_api_key)])
def update_thread_title(payload: TitlePayload):
    try:
        with get_db_session() as session:
            client = DBClient(session)
            success = client.update_conversation_title(payload.thread_id,payload.title)
            if not success:
                raise HTTPException(status_code=404, detail="Thread not found")
            session.commit()
            return {"status": "success"}
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


class BranchPayload(BaseModel):
    parent_thread_id: str
    new_thread_id: str
    upto_message_id: str
    title: str

class TruncatePayload(BaseModel):
    upto_message_id: str


class MessagePayload(BaseModel):
    thread_id: str
    message: str
    persona: str = "personal assistant"


@app.post("/chat/message", dependencies=[Depends(verify_api_key)])
async def chat_message(payload: MessagePayload):
    allowed_personas = ["personal assistant", "teacher", "analyst", "prompt builder"]
    if payload.persona not in allowed_personas:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported persona: '{payload.persona}'. Supported personas are: {allowed_personas}"
        )

    async def sse_generator():
        # Retrieve or create thread
        is_valid_uuid = False
        try:
            uuid.UUID(payload.thread_id)
            is_valid_uuid = True
        except ValueError:
            pass

        with get_db_session() as session:
            client = DBClient(session)
            conv = None
            if is_valid_uuid:
                conv = session.query(Conversation).filter_by(id=payload.thread_id).first()
            if not conv:
                conv = client.create_client_conversation(persona=payload.persona)
                session.commit()
            else:
                if payload.persona != conv.persona:
                    conv.persona = payload.persona
                    session.commit()
            thread_uuid = conv.id
            thread_title = conv.title
            thread_persona = conv.persona


        initial_state = {
            "messages": [HumanMessage(content=payload.message)],
            "db_conv_id": thread_uuid,
            "next_node": "supervisor",
            "persona": thread_persona
        }

        full_response = ""
        
        # Run graph.astream_events in a background producer task and queue the events.
        # This allows us to periodically yield SSE keep-alive pings to prevent Render timeouts
        # during long-running tool executions.
        queue = asyncio.Queue()

        async def producer():
            try:
                async for event in graph.astream_events(initial_state, version="v2"):
                    await queue.put(event)
            except asyncio.CancelledError:
                logger.info("Graph execution stream cancelled by client request")
                # Do not raise or queue; exit cleanly
            except Exception as e:
                await queue.put(e)
            finally:
                await queue.put(None)

        producer_task = asyncio.create_task(producer())

        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Yield SSE comment ping to keep connection alive
                    yield ": keep-alive\n\n"
                    continue

                if event is None:
                    break
                if isinstance(event, Exception):
                    logger.error("Error in graph execution stream", error=str(event))
                    yield f"data: {json.dumps({'type': 'error', 'message': str(event)})}\n\n"
                    break

                kind = event.get("event")
                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and chunk.content:
                        content = chunk.content
                        content_str = ""
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, str):
                                    content_str += item
                                elif isinstance(item, dict):
                                    content_str += item.get("text", "")
                                elif hasattr(item, "text"):
                                    content_str += item.text
                                elif hasattr(item, "get") and "text" in item:
                                    content_str += item.get("text")
                        elif isinstance(content, str):
                            content_str = content
                        else:
                            content_str = str(content)

                        if content_str:
                            full_response += content_str
                            yield f"data: {json.dumps({'type': 'content', 'delta': content_str})}\n\n"
        except asyncio.CancelledError:
            logger.info("SSE generator cancelled by client disconnect. Agent will continue running in the background.")
            raise
        finally:
            # We let the producer_task continue running to completion in the background
            # so the agent can finish processing and write the result to the database.
            pass

        # Generate a dynamic title if thread title is 'New Chat'
        if thread_title == "New Chat":
            # new_title = payload.message[:30] + "..." if len(payload.message) > 30 else payload.message
            response = get_llm().invoke("Return the Title for this conversation below : \n Conversation \n" + payload.message[:30])
            new_title = str(response.content) if hasattr(response, "content") else str(response)
            with get_db_session() as session:
                client = DBClient(session)
                client.update_conversation_title(thread_uuid, new_title)
                session.commit()
            title_to_send = new_title
        else:
            title_to_send = thread_title

        # Send final completed event
        yield f"data: {json.dumps({'type': 'done', 'thread_title': title_to_send, 'persona': thread_persona})}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")


@app.post("/chat/threads/branch", dependencies=[Depends(verify_api_key)])
def branch_thread(payload: BranchPayload):
    try:
        with get_db_session() as session:
            client = DBClient(session)
            parent_conv = session.query(Conversation).filter_by(id=payload.parent_thread_id).first()
            if not parent_conv:
                raise HTTPException(status_code=404, detail="Parent thread not found")
            
            new_conv = Conversation(id=payload.new_thread_id, title=payload.title[:255], persona=parent_conv.persona)
            session.add(new_conv)
            session.flush()
            
            experiences = client.get_conversation_history(payload.parent_thread_id)
            target_exp_id = payload.upto_message_id.replace("usr-", "").replace("ast-", "")
            
            found_target = False
            for exp in experiences:
                new_exp = Experience(
                    id=str(uuid.uuid4()),
                    conversation_id=payload.new_thread_id,
                    user_query=exp.user_query,
                    agent_response=exp.agent_response,
                    eval_score=exp.eval_score,
                    eval_reason=exp.eval_reason,
                    created_at=exp.created_at,
                    consolidated=exp.consolidated
                )
                session.add(new_exp)
                if str(exp.id) == target_exp_id:
                    found_target = True
                    break
            
            if not found_target:
                raise HTTPException(status_code=404, detail="Message not found in parent thread")
            
            session.commit()
            return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/threads/{thread_id}/truncate", dependencies=[Depends(verify_api_key)])
def truncate_thread(thread_id: str, payload: TruncatePayload):
    try:
        with get_db_session() as session:
            target_exp_id = payload.upto_message_id.replace("usr-", "").replace("ast-", "")
            target_exp = session.query(Experience).filter_by(id=target_exp_id, conversation_id=thread_id).first()
            if not target_exp:
                raise HTTPException(status_code=404, detail="Message not found in thread")
            
            session.query(Experience).filter(
                Experience.conversation_id == thread_id,
                Experience.created_at >= target_exp.created_at
            ).delete(synchronize_session=False)
            
            session.commit()
            return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/oauth/login")
def oauth_login(chat_id: int):
    logger.info("Generating Google OAuth login URL", chat_id=chat_id)
    client_config = {
        "web": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID", "mock_id"),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", "mock_secret"),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token"
        }
    }
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/oauth/callback")
    )
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=str(chat_id)
    )
    return responses.RedirectResponse(authorization_url)

@app.get("/oauth/callback")
def oauth_callback(code: str, state: str):
    telegram_chat_id = int(state)
    logger.info("Received Google OAuth redirect callback", state_chat_id=telegram_chat_id)
    conv_id = db.get_or_create_conversation(telegram_chat_id)
    
    # Exchanging mock code (would exchange real credentials with code in production)
    token_data = {
        "access_token": "mock_access_token",
        "refresh_token": "mock_refresh_token",
        "expiry": "2026-07-01T12:00:00Z"
    }
    db.store_oauth_tokens(conv_id, "google", token_data)
    
    html_content = """
    <html>
        <head>
            <style>
                body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #1e1e2e; color: #cdd6f4; }
                .card { background: #313244; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                h1 { color: #a6e3a1; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Authorization Successful!</h1>
                <p>Gmail and Google Calendar have been successfully linked to Vela.</p>
                <p>You can close this tab now and return to Telegram.</p>
            </div>
        </body>
    </html>
    """
    return responses.HTMLResponse(content=html_content)

@app.post("/webhooks/telegram")
async def telegram_webhook(request: Request, background_tasks: BackgroundTasks):
    logger.info("Telegram webhook endpoint triggered")
    payload = await request.json()
    background_tasks.add_task(telegram_gateway.handle_update, payload)
    return {"status": "processed", "result": "Task scheduled in background"}

@app.post("/consolidate")
def trigger_consolidation():
    logger.info("Triggering nightly self-improvement consolidation loop")
    msg = run_self_improvement()
    logger.info("Consolidation loop completed", result=msg)
    return {"status": "success"}

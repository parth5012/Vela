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
from db.models import Conversation



logger = StructuredLogger("VelaServer")
db = SupabaseDB()
telegram_gateway = TelegramGateway(db=db)
discord_gateway = DiscordGateway(db=db)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # logger.info("Initializing background services...")
    # discord_task = asyncio.create_task(discord_gateway.start())
    yield
    # logger.info("Shutting down background services...")
    # await discord_gateway.close()
    # discord_task.cancel()
    # try:
    #     await discord_task
    # except asyncio.CancelledError:
    #     pass

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


class MessagePayload(BaseModel):
    thread_id: str
    message: str


@app.post("/chat/message", dependencies=[Depends(verify_api_key)])
async def chat_message(payload: MessagePayload):
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
                conv = client.create_client_conversation()
                session.commit()
            thread_uuid = conv.id
            thread_title = conv.title


        initial_state = {
            "messages": [HumanMessage(content=payload.message)],
            "db_conv_id": thread_uuid,
            "next_node": "supervisor"
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
                        full_response += chunk.content
                        yield f"data: {json.dumps({'type': 'content', 'delta': chunk.content})}\n\n"
        finally:
            if not producer_task.done():
                producer_task.cancel()
                try:
                    await producer_task
                except asyncio.CancelledError:
                    pass

        # Generate a dynamic title if thread title is 'New Chat'
        if thread_title == "New Chat":
            new_title = payload.message[:30] + "..." if len(payload.message) > 30 else payload.message
            with get_db_session() as session:
                client = DBClient(session)
                client.update_conversation_title(thread_uuid, new_title)
                session.commit()
            title_to_send = new_title
        else:
            title_to_send = thread_title

        # Send final completed event
        yield f"data: {json.dumps({'type': 'done', 'thread_title': title_to_send})}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")



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

from utils.helpers import get_title
from agent.persona import PUBLIC_LIST as PERSONA_LIST
from agent.registry import AGENT_REGISTRY
from utils.llm import get_llm
import os
import asyncio
import sys
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
import base64
import urllib.parse
from datetime import datetime, timedelta, timezone
import httpx
from httpx import HTTPStatusError
from pydantic import BaseModel, model_validator, Field, AliasChoices
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from agent.graph import graph
from db.models import Conversation, Experience

# Import PENDING_TASKS at runtime to avoid module duplication issues
# This ensures we always reference the current module's PENDING_TASKS dict
# rather than a captured reference from import time

def get_pending_tasks():
    """Get the current PENDING_TASKS dict from the webview_browser module."""
    module = sys.modules.get("tools.webview_browser")
    if module is None:
        raise RuntimeError("tools.webview_browser module not found")
    return module.PENDING_TASKS



logger = StructuredLogger("VelaServer")
db = SupabaseDB()
telegram_gateway = TelegramGateway(db=db)
discord_gateway = DiscordGateway(db=db)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run database migration: rename persona → agent, ensure active_skill exists
    try:
        from db.session import engine
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('conversations')]
        if 'persona' in columns:
            logger.info("Database migration: renaming 'persona' column to 'agent'")
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE conversations RENAME COLUMN persona TO agent"))
        elif 'agent' not in columns:
            logger.info("Database migration: adding 'agent' column to 'conversations' table")
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE conversations ADD COLUMN agent VARCHAR(50) DEFAULT 'personal assistant' NOT NULL"))
        if 'active_skill' not in columns:
            logger.info("Database migration: adding 'active_skill' column to 'conversations' table")
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE conversations ADD COLUMN active_skill VARCHAR(50) DEFAULT NULL"))
    except Exception as e:
        logger.error("Failed to run database migration", error=str(e))

    yield

app = FastAPI(title="Vela Server", lifespan=lifespan)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file"
]

@app.get("/")
def health():
    logger.info("Health check pinged")
    return {"status": "ok"}

    
security = HTTPBearer(auto_error=False)

def verify_api_key(request: Request, credentials: HTTPAuthorizationCredentials = Security(security)):
    auth_header = request.headers.get("authorization")
    logger.info("Received API key verification request", auth_header_present=auth_header is not None, auth_header_prefix=auth_header[:15] if auth_header else None)
    if credentials is None:
        logger.warning("Authentication failed: No credentials provided.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authenticated"
        )
    expected_key = os.getenv("VELA_API_KEY", "vela5012")
    if not expected_key or expected_key.startswith("your_"):
        logger.error("Authentication failed: VELA_API_KEY is not configured on the server.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API Key is not configured on the server."
        )
    if credentials.credentials != expected_key:
        logger.warning("Authentication failed: Invalid credentials key mismatch.")
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
                    "agent": t.agent,
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
    normalized_id = normalize_thread_id(thread_id)
    try:
        with get_db_session() as session:
            conv = session.query(Conversation).filter_by(id=normalized_id).first()
            if not conv:
                raise HTTPException(status_code=404, detail="Thread not found")

            client = DBClient(session)
            experiences = client.get_conversation_history(normalized_id)
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class TitlePayload(BaseModel):
    thread_id : str
    title: str

@app.post("/chats/threads", dependencies=[Depends(verify_api_key)])
@app.post("/chat/threads/", dependencies=[Depends(verify_api_key)])
def update_thread_title(payload: TitlePayload):
    normalized_id = normalize_thread_id(payload.thread_id)
    try:
        with get_db_session() as session:
            client = DBClient(session)
            success = client.update_conversation_title(normalized_id, payload.title)
            if not success:
                raise HTTPException(status_code=404, detail="Thread not found")
            session.commit()
            return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/chat/threads/{thread_id}", dependencies=[Depends(verify_api_key)])
def delete_thread(thread_id: str):
    normalized_id = normalize_thread_id(thread_id)
    try:
        with get_db_session() as session:
            client = DBClient(session)
            success = client.delete_conversation(normalized_id)
            if not success:
                raise HTTPException(status_code=404, detail="Thread not found")
            session.commit()
            return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def normalize_thread_id(thread_id: str) -> str:
    try:
        uuid.UUID(thread_id)
        return thread_id
    except ValueError:
        # Generate a deterministic UUID from the non-UUID thread_id string
        NAMESPACE_VELA = uuid.UUID('e654936d-9d7a-421b-bb49-853f8018eeb0')
        return str(uuid.uuid5(NAMESPACE_VELA, thread_id))


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
    agent: str = Field(default="personal assistant", validation_alias=AliasChoices("agent", "persona"))
    google_access_token: str | None = None


from agent.concurrency import get_stream_semaphore

@app.post("/chat/message", dependencies=[Depends(verify_api_key)])
async def chat_message(payload: MessagePayload):
    allowed_agents = [config.identifier for config in AGENT_REGISTRY.list_agents()]
    if payload.agent not in allowed_agents:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported agent: '{payload.agent}'. Supported agents are: {allowed_agents}"
        )

    async def sse_generator():
        semaphore = get_stream_semaphore()
        await semaphore.acquire()
        producer_started = False
        normalized_id = None
        streaming_complete = False
        try:
            # Retrieve or create thread
            normalized_id = normalize_thread_id(payload.thread_id)

            with get_db_session() as session:
                client = DBClient(session)
                conv = session.query(Conversation).filter_by(id=normalized_id).first()
                if not conv:
                    conv = client.create_client_conversation(agent=payload.agent, conversation_id=normalized_id)
                    session.commit()
                else:
                    if payload.agent != conv.agent:
                        conv.agent = payload.agent
                        session.commit()
                thread_uuid = conv.id
                thread_title = conv.title
                thread_agent = conv.agent


            initial_state = {
                "messages": [HumanMessage(content=payload.message)],
                "db_conv_id": thread_uuid,
                "next_node": "supervisor",
                "agent": thread_agent
            }
            initial_message = payload.message

            full_response = ""
            logger.info("Starting chat message", thread_id=normalized_id, agent=thread_agent)
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
                    # Check and evaluate any active running webview session for this thread
                    try:
                        from tools.webview_browser import evaluate_webview_session
                        from db.models import WebViewAutomationSession
                        with get_db_session() as db_session:
                            active_session = (
                                db_session.query(WebViewAutomationSession)
                                .filter_by(conversation_id=normalized_id, status="running")
                                .first()
                            )
                            if active_session:
                                asyncio.create_task(evaluate_webview_session(active_session.id))
                    except Exception as ex:
                        logger.error("Failed to trigger webview session evaluation", error=str(ex))

            producer_task = asyncio.create_task(producer())
            producer_started = True

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
                    elif kind == "on_tool_start":
                        tool_name = event.get("name")
                        tool_input = event.get("data", {}).get("input", {})
                        if tool_name == "webview_browser":
                            import tools.webview_browser
                            conv_id = tool_input.get("conversation_id")
                            if conv_id:
                                task_token = str(uuid.uuid4())
                                tools.webview_browser.LAST_TOOL_START_TOKENS[conv_id] = task_token
                                tool_input["conversation_id"] = f"{conv_id}_{task_token}"
                        try:
                            input_str = json.dumps(tool_input)
                        except Exception:
                            input_str = str(tool_input)
                        escaped_input = input_str.replace('\\', '\\\\').replace('"', '\\"')
                        tool_start_tag = f'<call:{tool_name} input="{escaped_input}">'
                        full_response += tool_start_tag
                        yield f"data: {json.dumps({'type': 'content', 'delta': tool_start_tag})}\n\n"
                    elif kind == "on_tool_end":
                        tool_name = event.get("name")
                        tool_output = event.get("data", {}).get("output", "")
                        if not isinstance(tool_output, str):
                            try:
                                tool_output = json.dumps(tool_output)
                            except Exception:
                                tool_output = str(tool_output)
                        # Simulate SSE emission when Google Workspace tool blocked due to auth_required
                        if "Google Workspace not connected" in tool_output or "auth_required" in tool_output:
                            yield f"data:{json.dumps({'type': 'auth_required', 'provider': 'google'})}\n\n"
                        tool_end_tag = f'{tool_output}</call:{tool_name}>'
                        full_response += tool_end_tag
                        yield f"data: {json.dumps({'type': 'content', 'delta': tool_end_tag})}\n\n"
            except asyncio.CancelledError:
                logger.info("SSE generator cancelled by client disconnect. Agent will continue running in the background.")
                raise
            finally:
                # We let the producer_task continue running to completion in the background
                # so the agent can finish processing and write the result to the database.
                logger.info("SSE generator finished", thread_id=normalized_id)
                # Release semaphore as soon as streaming is complete so new streams
                # can start while post-processing (DB writes, title generation) happens.
                streaming_complete = True
                semaphore.release()
                logger.info("Semaphore released after streaming complete", thread_id=normalized_id)

            # Update the latest Experience record with full_response if it contains tool calls or thoughts
            if full_response:
                try:
                    with get_db_session() as session:
                        last_exp = (
                            session.query(Experience)
                            .filter_by(conversation_id=normalized_id)
                            .order_by(Experience.created_at.desc())
                            .first()
                        )
                        if last_exp:
                            last_exp.agent_response = full_response or ''
                            session.commit()
                        else:
                            new_exp = Experience(conversation_id=normalized_id, user_query=initial_message, agent_response=full_response)
                            session.add(new_exp)
                            session.commit()
                        logger.info("Experience record updated", conversation_id=normalized_id)
                except Exception as e:
                    logger.error("Failed to update database with full_response", error=str(e))

            # Generate a dynamic title if thread title is 'New Chat'
            if thread_title == "New Chat":
                # new_title = payload.message[:30] + "..." if len(payload.message) > 30 else payload.message
                response = await asyncio.to_thread(get_title, initial_message)
                new_title = str(response.content) if hasattr(response, "content") else str(response)
                with get_db_session() as session:
                    client = DBClient(session)
                    client.update_conversation_title(thread_uuid, new_title)
                    session.commit()
                title_to_send = new_title
            else:
                title_to_send = thread_title

            # Send final completed event
            yield f"data: {json.dumps({'type': 'done', 'thread_title': title_to_send, 'agent': thread_agent})}\n\n"
        except BaseException:
            # Ensure semaphore is released if streaming failed before explicit release above
            # (e.g. CancelledError from client disconnect, or any other unexpected error)
            if not streaming_complete:
                semaphore.release()
                logger.info("Semaphore released in sse_generator error handler", thread_id=normalized_id)
            raise

    return StreamingResponse(sse_generator(), media_type="text/event-stream")


@app.post("/chat/threads/branch", dependencies=[Depends(verify_api_key)])
def branch_thread(payload: BranchPayload):
    try:
        parent_id = normalize_thread_id(payload.parent_thread_id)
        new_id = normalize_thread_id(payload.new_thread_id)
        with get_db_session() as session:
            client = DBClient(session)
            try:
                parent_conv = session.query(Conversation).filter_by(id=parent_id).first()
            except Exception:
                parent_conv = None

            if not parent_conv:
                raise HTTPException(status_code=404, detail="Parent thread not found")
            
            new_conv = Conversation(id=new_id, title=payload.title[:255], agent=parent_conv.agent)
            session.add(new_conv)
            session.flush()
            
            experiences = client.get_conversation_history(parent_id)
            target_exp_id = payload.upto_message_id.replace("usr-", "").replace("ast-", "")
            
            found_target = False
            for exp in experiences:
                new_exp = Experience(
                    id=str(uuid.uuid4()),
                    conversation_id=new_id,
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
    normalized_id = normalize_thread_id(thread_id)
    try:
        with get_db_session() as session:
            target_exp_id = payload.upto_message_id.replace("usr-", "").replace("ast-", "")
            try:
                target_exp = session.query(Experience).filter_by(id=target_exp_id, conversation_id=normalized_id).first()
            except Exception:
                target_exp = None
            if not target_exp:
                raise HTTPException(status_code=404, detail="Message not found in thread")
            
            session.query(Experience).filter(
                Experience.conversation_id == normalized_id,
                Experience.created_at >= target_exp.created_at
            ).delete(synchronize_session=False)
            
            session.commit()
            return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class ClientOAuthPayload(BaseModel):
    conversation_id: str
    access_token: str
    refresh_token: str = ""
    expiry: str = ""
    scopes: list[str] = []

@app.post("/oauth/token", dependencies=[Depends(verify_api_key)])
def store_oauth_token(payload: ClientOAuthPayload):
    """Receives Google OAuth tokens from the mobile app client and stores them.
    
    The Vela agent tools can later retrieve these tokens to access Google Workspace
    APIs (Gmail, Calendar, Drive) on behalf of the user.
    """
    logger.info("Storing OAuth tokens from mobile client", conversation_id=payload.conversation_id)
    try:
        with get_db_session() as session:
            client = DBClient(session)
            # Ensure the conversation exists (create if it doesn't)
            conv = session.query(Conversation).filter_by(id=payload.conversation_id).first()
            if not conv:
                conv = client.create_client_conversation(conversation_id=payload.conversation_id)
                session.commit()

            token_data = {
                "access_token": payload.access_token,
                "refresh_token": payload.refresh_token,
                "expiry": payload.expiry,
                "scopes": payload.scopes,
            }
            client.store_oauth_token(payload.conversation_id, "google", token_data)
            session.commit()

        logger.info("OAuth tokens stored successfully", conversation_id=payload.conversation_id)
        return {"status": "success", "provider": "google"}
    except Exception as e:
        logger.error("Failed to store OAuth tokens", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


class RevokePayload(BaseModel):
    conversation_id: str

@app.post("/oauth/token/revoke", dependencies=[Depends(verify_api_key)])
def revoke_oauth_token(payload: RevokePayload):
    """Revokes Google OAuth tokens for a conversation."""
    logger.info("Revoking OAuth tokens for conversation", conversation_id=payload.conversation_id)
    try:
        with get_db_session() as session:
            from db.models import OAuthToken
            token_record = session.query(OAuthToken).filter_by(
                conversation_id=payload.conversation_id, provider="google"
            ).first()
            if token_record:
                session.delete(token_record)
                session.commit()
                logger.info("OAuth tokens revoked successfully", conversation_id=payload.conversation_id)
            return {"status": "success"}
    except Exception as e:
        logger.error("Failed to revoke OAuth tokens", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/oauth/token/status", dependencies=[Depends(verify_api_key)])
def get_oauth_status(conversation_id: str = Query(default=None)):
    """Returns Google OAuth connection status for a conversation.

    For the mobile client flow (where conversation_id may not be known by
    the client), the endpoint falls back to the latest Google tokens in the
    database — acceptable for this single-tenant backend.

    Returns:
        ``{"connected": true/false}`` plus, when connected:
        ``user`` (name, email, picture), ``access_token``, ``refresh_token``,
        ``id_token``, and ``expires_at``.
    """
    try:
        with get_db_session() as session:
            dbc = DBClient(session)

            token_record = dbc.get_oauth_token("global", "google")

            if not token_record:
                return {"connected": False}

            token_data = token_record.token
            user_info = token_data.get("user_info", {})

            result = {
                "connected": True,
                "user": {
                    "name": user_info.get("name", "Google User"),
                    "email": user_info.get("email", ""),
                    "picture": user_info.get("picture", ""),
                },
                "access_token": token_data.get("access_token", ""),
                "refresh_token": token_data.get("refresh_token", ""),
                "id_token": token_data.get("id_token", ""),
                "expires_at": token_data.get("expiry", ""),
            }
            return result
    except Exception as e:
        logger.error("Failed to check OAuth token status", error=str(e))
        return {"connected": False}


@app.get("/oauth/google/authorize")
def oauth_google_authorize(
    redirect_uri: str = Query(default="vela-client://oauth/callback"),
    api_key: str = Query(None),
):
    """Mobile client OAuth entry point.

    Called by the Vela Android client via ``WebBrowser.openAuthSessionAsync``.
    Validates the API key, creates a client conversation, encodes the
    conversation ID and redirect URI into the state parameter, then redirects
    to Google's OAuth consent screen.

    After the user authorizes, Google redirects to ``/oauth/callback`` which
    exchanges the code for tokens and redirects back to the client's custom
    scheme (e.g. ``vela-client://oauth/callback?status=success``).
    """
    logger.info("Google OAuth authorize endpoint called")

    # Validate the API key
    expected_key = os.getenv("VELA_API_KEY", "vela5012")
    if not api_key or api_key != expected_key:
        logger.warning(f'Received invalid API key: {api_key}')
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Use global conversation ID for OAuth flow instead of creating throwaway ones
    conversation_id = "global"
    logger.info("Using global conversation for OAuth flow", conversation_id=conversation_id)

    # Encode state: conversation_id + client redirect_uri
    state_data = base64.urlsafe_b64encode(
        json.dumps({
            "cid": str(conversation_id),
            "ruri": redirect_uri,
        }).encode()
    ).decode()

    client_config = {
        "web": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }

    backend_redirect_uri = os.getenv(
        "GOOGLE_REDIRECT_URI",
        "http://localhost:8000/oauth/callback",
    )

    # PKCE is disabled on purpose: this is a confidential web-client flow where
    # the server exchanges the code with its client_secret. The callback performs
    # a manual token exchange that never sends a code_verifier, so auto-generating
    # one here would make Google reject the exchange with a 400.
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=backend_redirect_uri,
        autogenerate_code_verifier=False,
    )
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=state_data,
        prompt="consent",
    )

    logger.info("Redirecting to Google OAuth", url=authorization_url[:80] + "...")
    return responses.RedirectResponse(authorization_url)


@app.get("/oauth/login")
def oauth_login(chat_id: int):
    """Legacy Telegram OAuth entry point — kept for backward compatibility."""
    logger.info("Generating Google OAuth login URL (legacy)", chat_id=chat_id)
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
        redirect_uri=os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/oauth/callback"),
        autogenerate_code_verifier=False,
    )
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=str(chat_id)
    )
    return responses.RedirectResponse(authorization_url)


@app.get("/oauth/callback")
def oauth_callback(code: str, state: str):
    """Google OAuth callback — exchanges auth code for real tokens.

    Handles two state formats:
    1. **Mobile client flow** (new): base64-encoded JSON with ``cid`` and ``ruri``.
       After storing tokens, redirects to the client's custom scheme URI.
    2. **Telegram flow** (legacy): plain ``chat_id`` integer.
       After storing tokens, renders a success HTML page.
    """
    logger.info("Google OAuth callback received")

    # ── Try to decode state as the new JSON format ──
    conversation_id = None
    redirect_uri = None
    try:
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        parsed = json.loads(decoded)
        conversation_id = parsed.get("cid")
        redirect_uri = parsed.get("ruri")
        logger.info("Decoded mobile client state", conversation_id=conversation_id)
    except Exception:
        logger.info("State is not JSON — treating as legacy telegram chat_id")

    # ── Fallback to legacy Telegram flow ──
    if not conversation_id:
        try:
            telegram_chat_id = int(state)
            logger.info("Legacy Telegram OAuth callback", chat_id=telegram_chat_id)
            conversation_id = db.get_or_create_conversation(telegram_chat_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid state parameter")

    # ── Exchange the authorization code for real tokens ──
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    backend_redirect_uri = os.getenv(
        "GOOGLE_REDIRECT_URI",
        "http://localhost:8000/oauth/callback",
    )

    if not client_id or not client_secret:
        logger.error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured")
        if redirect_uri:
            return responses.RedirectResponse(
                f"{redirect_uri}?status=error&message=Server+not+configured"
            )
        return responses.HTMLResponse(
            "<html><body><h1>Configuration Error</h1><p>Google OAuth is not configured.</p></body></html>",
            status_code=500,
        )

    try:
        token_response = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": backend_redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=30,
        )
        token_response.raise_for_status()
        google_tokens = token_response.json()
        logger.info("Token exchange successful")
    except HTTPStatusError as e:
        # Include the response body — it carries the real Google error reason
        # (e.g. invalid_grant, redirect_uri_mismatch) that the exception alone hides.
        body = e.response.text if e.response is not None else ""
        logger.error(
            "Token exchange failed",
            error=str(e),
            status_code=e.response.status_code if e.response is not None else None,
            response_body=body[:500],
        )
        if redirect_uri:
            return responses.RedirectResponse(
                f"{redirect_uri}?status=error&message=Token+exchange+failed"
            )
        return responses.HTMLResponse(
            f"<html><body><h1>Token Exchange Failed</h1><p>{str(e)}</p></body></html>",
            status_code=500,
        )
    except Exception as e:
        logger.error("Token exchange failed", error=str(e))
        if redirect_uri:
            return responses.RedirectResponse(
                f"{redirect_uri}?status=error&message=Token+exchange+failed"
            )
        return responses.HTMLResponse(
            f"<html><body><h1>Token Exchange Failed</h1><p>{str(e)}</p></body></html>",
            status_code=500,
        )

    access_token = google_tokens.get("access_token", "")
    refresh_token = google_tokens.get("refresh_token", "")
    expires_in = google_tokens.get("expires_in", 3600)
    id_token_jwt = google_tokens.get("id_token", "")

    # Calculate absolute expiry
    expiry = (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat()

    # ── Fetch user info from Google's userinfo endpoint ──
    user_info = {}
    try:
        user_resp = httpx.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if user_resp.status_code == 200:
            user_info = user_resp.json()
            logger.info("Fetched Google user info", email=user_info.get("email"))
    except Exception as e:
        logger.error("Failed to fetch user info", error=str(e))

    # ── Store tokens in database ──
    token_record = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expiry": expiry,
        "scopes": SCOPES,
        "id_token": id_token_jwt,
        "user_info": user_info,
    }

    db.store_oauth_tokens("global", "google", token_record)
    logger.info("OAuth tokens stored", conversation_id="global")

    # ── Redirect back to client (mobile flow) ──
    if redirect_uri:
        params = urllib.parse.urlencode({
            "status": "success",
        })
        client_redirect = f"{redirect_uri}?{params}"
        logger.info("Redirecting back to mobile client", url=client_redirect)
        return responses.RedirectResponse(client_redirect)

    # ── Legacy Telegram flow: show success HTML ──
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


@app.post("/webhooks/carbonvoice")
async def carbonvoice_webhook(request: Request):
    logger.info("Carbon Voice webhook endpoint triggered")
    content_type = request.headers.get("content-type", "")
    payload = {}
    audio_bytes = None
    audio_filename = None
    audio_mime_type = None

    if "application/json" in content_type:
        try:
            payload = await request.json()
        except Exception as e:
            logger.error("Failed to parse JSON body", error=str(e))
            raise HTTPException(status_code=400, detail="Invalid JSON body")
    elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        try:
            form_data = await request.form()
            for key, value in form_data.items():
                if isinstance(value, str):
                    payload[key] = value
            
            file_field = form_data.get("file") or form_data.get("audio") or form_data.get("media")
            if file_field and hasattr(file_field, "file"):
                audio_bytes = await file_field.read()
                audio_filename = file_field.filename
                audio_mime_type = file_field.content_type
        except Exception as e:
            logger.error("Failed to parse form data", error=str(e))
            raise HTTPException(status_code=400, detail="Invalid form data")
    else:
        try:
            raw_body = await request.body()
            payload = {"text": raw_body.decode("utf-8")}
        except Exception:
            pass

    auth_header = request.headers.get("authorization")
    from gateway.carbonvoice import CarbonVoiceGateway
    gateway = CarbonVoiceGateway(db)
    result = await gateway.handle_webhook(
        payload=payload,
        audio_file_bytes=audio_bytes,
        audio_filename=audio_filename,
        audio_mime_type=audio_mime_type,
        auth_header=auth_header
    )
    return result
class WebViewResponsePayload(BaseModel):
    conversation_id: str
    status: str
    result: str

@app.post("/chat/webview/response", dependencies=[Depends(verify_api_key)])
def submit_webview_response(payload: WebViewResponsePayload):
    conversation_id = payload.conversation_id
    key = None
    pending_tasks = get_pending_tasks()
    if conversation_id in pending_tasks:
        key = conversation_id
    else:
        for k in pending_tasks.keys():
            if k.startswith(f"{conversation_id}_"):
                key = k
                break
    if key:
        pending_tasks[key]["response"] = {
            "status": payload.status,
            "result": payload.result
        }
        pending_tasks[key]["event"].set()
        logger.info("Received WebView response for task", conversation_id=conversation_id, status=payload.status)
        return {"status": "accepted"}
    else:
        logger.warning("Received WebView response but no pending task found", conversation_id=conversation_id)
        raise HTTPException(status_code=404, detail="No pending task found for this conversation ID")

@app.post("/consolidate", dependencies=[Depends(verify_api_key)])
def trigger_consolidation():
    logger.info("Triggering nightly self-improvement consolidation loop")
    msg = run_self_improvement()
    logger.info("Consolidation loop completed", result=msg)
    return {"status": "success"}

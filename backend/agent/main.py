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
from db.database import PostgresDB
from gateway.telegram import TelegramGateway
from gateway.discord import DiscordGateway
from cron.consolidate import run_self_improvement, run_daily_briefing
from utils.logger import StructuredLogger
from db.client import DBClient
from db.session import get_db_session
import json
import uuid
import base64
import urllib.parse
from datetime import date as dt_date, datetime, timedelta, timezone
from uuid import UUID
import httpx
from httpx import HTTPStatusError
from typing import Optional
from pydantic import BaseModel, model_validator, Field, AliasChoices
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from agent.graph import graph
from db.models import Conversation, Experience, SyncMessage, ToolInvocation, Base, utcnow_naive
from fastapi import Response
from utils.ulid import generate_ulid
from utils.auth_gate import GLOBAL_OAUTH_CONVERSATION_ID

# Import PENDING_TASKS at runtime to avoid module duplication issues
# This ensures we always reference the current module's PENDING_TASKS dict
# rather than a captured reference from import time

def get_pending_tasks():
    """Get the current PENDING_TASKS dict from the pending_tasks module."""
    import tools.pending_tasks
    return tools.pending_tasks.PENDING_TASKS



logger = StructuredLogger("VelaServer")

BACKGROUND_TASKS: set[asyncio.Task] = set()

def create_background_task(coro):
    """Creates an asyncio background task and maintains a strong reference until completion."""
    task = asyncio.create_task(coro)
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)
    return task

def _safe_set_event(task_data: dict) -> None:
    """Safely sets an asyncio.Event across threads using call_soon_threadsafe on its loop."""
    event = task_data.get("event")
    if not event:
        return
    loop = task_data.get("loop")
    if loop and loop.is_running():
        loop.call_soon_threadsafe(event.set)
    else:
        try:
            current_loop = asyncio.get_running_loop()
            current_loop.call_soon_threadsafe(event.set)
        except RuntimeError:
            event.set()

db = PostgresDB()
telegram_gateway = TelegramGateway(db=db)
discord_gateway = DiscordGateway(db=db)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run database migrations with individual error boundaries
    from db.session import engine, ensure_prod_schema
    from sqlalchemy import inspect, text

    # T8: idempotent prod DDL guard FIRST so a clean Postgres boots —
    # Base.metadata.create_all (check_first) converges both this path and
    # migrate.py on db.models as the single source of truth (no Alembic).
    try:
        ensure_prod_schema(engine)
    except Exception as e:
        logger.error("Failed to ensure prod schema", error=str(e))

    try:
        inspector = inspect(engine)
    except Exception as e:
        logger.error("Failed to inspect database engine", error=str(e))
        inspector = None

    if inspector is not None:
        # 1. Conversations table migrations
        try:
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
            if 'is_pinned' not in columns:
                logger.info("Database migration: adding 'is_pinned' column to 'conversations' table")
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE conversations ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE NOT NULL"))
            if 'source' not in columns:
                logger.info("Database migration: adding 'source' column to 'conversations' table")
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE conversations ADD COLUMN source VARCHAR(50) DEFAULT 'telegram' NOT NULL"))
        except Exception as e:
            logger.error("Failed to run conversations table migration", error=str(e))

        # 2. Create tool_invocations table if not exists
        try:
            table_names = inspector.get_table_names()
            if 'tool_invocations' not in table_names:
                logger.info("Database migration: creating 'tool_invocations' table")
                with engine.begin() as conn:
                    conn.execute(text("""
                        CREATE TABLE tool_invocations (
                            request_id VARCHAR(50) PRIMARY KEY,
                            tool_name VARCHAR(100) NOT NULL,
                            status VARCHAR(50) NOT NULL,
                            result TEXT,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    """))
        except Exception as e:
            logger.error("Failed to create tool_invocations table", error=str(e))

        # 3. Create sync_messages table if not exists
        try:
            table_names = inspector.get_table_names()
            if 'sync_messages' not in table_names:
                logger.info("Database migration: creating 'sync_messages' table")
                conv_id_type = "UUID" if engine.dialect.name == "postgresql" else "VARCHAR(255)"
                with engine.begin() as conn:
                    conn.execute(text(f"""
                        CREATE TABLE sync_messages (
                            id VARCHAR(50) PRIMARY KEY,
                            conversation_id {conv_id_type} NOT NULL,
                            role VARCHAR(50) NOT NULL,
                            content TEXT NOT NULL,
                            provider VARCHAR(50) NOT NULL,
                            created_at BIGINT NOT NULL,
                            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                        )
                    """))
        except Exception as e:
            logger.error("Failed to create sync_messages table", error=str(e))

        # 4. Create system_settings table if not exists
        try:
            table_names = inspector.get_table_names()
            if 'system_settings' not in table_names:
                logger.info("Database migration: creating 'system_settings' table")
                with engine.begin() as conn:
                    conn.execute(text("""
                        CREATE TABLE system_settings (
                            key VARCHAR(100) PRIMARY KEY,
                            value TEXT NOT NULL,
                            updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
                        )
                    """))
            else:
                columns = [col['name'] for col in inspector.get_columns('system_settings')]
                if 'updated_at' not in columns:
                    logger.info("Database migration: adding 'updated_at' column to 'system_settings' table")
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE system_settings ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL"))
        except Exception as e:
            logger.error("Failed to create/migrate system_settings table", error=str(e))

        # 5. Create briefings table if not exists
        try:
            table_names = inspector.get_table_names()
            if 'briefings' not in table_names:
                logger.info("Database migration: creating 'briefings' table")
                created_at_default = "timezone('utc'::text, now())" if engine.dialect.name == "postgresql" else "CURRENT_TIMESTAMP"
                with engine.begin() as conn:
                    conn.execute(text(f"""
                        CREATE TABLE briefings (
                            id VARCHAR(36) PRIMARY KEY,
                            user_id VARCHAR(255),
                            date VARCHAR(10) NOT NULL,
                            summary_text TEXT,
                            sections_json JSON,
                            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT {created_at_default} NOT NULL
                        )
                    """))
        except Exception as e:
            logger.error("Failed to create briefings table", error=str(e))

        # 6. Create check_ins table if not exists
        try:
            table_names = inspector.get_table_names()
            if 'check_ins' not in table_names:
                logger.info("Database migration: creating 'check_ins' table")
                created_at_default = "timezone('utc'::text, now())" if engine.dialect.name == "postgresql" else "CURRENT_TIMESTAMP"
                with engine.begin() as conn:
                    conn.execute(text(f"""
                        CREATE TABLE check_ins (
                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                            conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
                            date VARCHAR(10) NOT NULL,
                            mood INTEGER NOT NULL CHECK (mood >= 1 AND mood <= 5),
                            energy INTEGER NOT NULL CHECK (energy >= 1 AND energy <= 5),
                            win TEXT,
                            carrying TEXT,
                            note TEXT,
                            source VARCHAR(50) DEFAULT 'android_client' NOT NULL,
                            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT {created_at_default} NOT NULL,
                            updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT {created_at_default} NOT NULL,
                            CONSTRAINT uq_checkins_conversation_date UNIQUE (conversation_id, date)
                        )
                    """))
        except Exception as e:
            logger.error("Failed to create check_ins table", error=str(e))

        # 7. Migrate oauth_tokens PK (conversation_id) -> (conversation_id, provider)
        # so one Conversation can hold google + future providers (T2).
        try:
            from sqlalchemy import inspect as sa_inspect
            fresh_inspector = sa_inspect(engine)
            if 'oauth_tokens' in fresh_inspector.get_table_names():
                pk_cols = set(
                    (fresh_inspector.get_pk_constraint('oauth_tokens') or {}).get('constrained_columns', [])
                )
                if pk_cols == {'conversation_id'}:
                    logger.info("Database migration: oauth_tokens PK -> (conversation_id, provider)")
                    if engine.dialect.name == "postgresql":
                        with engine.begin() as conn:
                            conn.execute(text("ALTER TABLE oauth_tokens DROP CONSTRAINT IF EXISTS oauth_tokens_pkey"))
                            conn.execute(text("ALTER TABLE oauth_tokens ALTER COLUMN provider SET NOT NULL"))
                            conn.execute(text("ALTER TABLE oauth_tokens ADD PRIMARY KEY (conversation_id, provider)"))
                    else:
                        # SQLite cannot drop PK constraints; rebuild preserving rows.
                        with engine.begin() as conn:
                            conn.execute(text("ALTER TABLE oauth_tokens RENAME TO oauth_tokens_legacy"))
                            conn.execute(text("""
                                CREATE TABLE oauth_tokens (
                                    conversation_id VARCHAR(255) NOT NULL,
                                    provider VARCHAR(50) NOT NULL,
                                    token_data JSON NOT NULL,
                                    created_at TIMESTAMP,
                                    updated_at TIMESTAMP,
                                    PRIMARY KEY (conversation_id, provider),
                                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                                )
                            """))
                            conn.execute(text("INSERT INTO oauth_tokens SELECT conversation_id, provider, token_data, created_at, updated_at FROM oauth_tokens_legacy"))
                            conn.execute(text("DROP TABLE oauth_tokens_legacy"))
        except Exception as e:
            logger.error("Failed to migrate oauth_tokens primary key", error=str(e))
            raise

        # 8. Widen conversations chat-ID columns to BIGINT on PostgreSQL (T2):
        # models declare BigInteger to match schema.sql; pre-existing INTEGER
        # columns would reject Discord snowflakes above 2^31-1. SQLite needs
        # no change (its INTEGER already stores 64-bit).
        try:
            if engine.dialect.name == "postgresql":
                from sqlalchemy import inspect as sa_inspect_bigint
                pg_cols = {c["name"]: str(c["type"]) for c in sa_inspect_bigint(engine).get_columns("conversations")}
                for chat_col in ("telegram_chat_id", "discord_channel_id"):
                    col_type = pg_cols.get(chat_col, "")
                    if col_type and "BIGINT" not in col_type.upper() and "INT8" not in col_type.upper():
                        logger.info(f"Database migration: widening conversations.{chat_col} to BIGINT")
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE conversations ALTER COLUMN {chat_col} TYPE BIGINT"))
        except Exception as e:
            logger.error("Failed to widen conversations chat-ID columns to BIGINT", error=str(e))
            raise

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
    return {"status": "ok", "tool_proxy": "available"}


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
                    "is_pinned": t.is_pinned,
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

class UpdateThreadPayload(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None

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
            return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/chat/threads/{thread_id}", dependencies=[Depends(verify_api_key)])
def update_thread(thread_id: str, payload: UpdateThreadPayload):
    normalized_id = normalize_thread_id(thread_id)
    try:
        with get_db_session() as session:
            client = DBClient(session)
            conv = session.query(Conversation).filter_by(id=normalized_id).first()
            if not conv:
                raise HTTPException(status_code=404, detail="Thread not found")
            if payload.title is not None:
                client.update_conversation_title(normalized_id, payload.title)
            if payload.is_pinned is not None:
                conv.is_pinned = payload.is_pinned
                conv.updated_at = utcnow_naive()
            return {"status": "success", "title": conv.title, "is_pinned": conv.is_pinned}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DeviceTokenPayload(BaseModel):
    token: str


@app.post("/api/config/device-token", dependencies=[Depends(verify_api_key)])
async def register_device_token(payload: DeviceTokenPayload):
    try:
        db.set_system_setting("fcm_device_token", payload.token)
        logger.info("Successfully registered/updated FCM device token", token_prefix=payload.token[:12])
        return {"status": "success", "message": "FCM device token registered"}
    except Exception as e:
        logger.error("Failed to register FCM device token", error=str(e))
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
            return {"status": "success"}
    except HTTPException:
        raise
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


def _persist_sse_turn_sync(
    experience_id: str | None,
    conversation_id: str | None,
    user_query: str,
    full_response: str,
) -> bool:
    """Blocking turn persistence: update the owned Experience row by ID.

    T6 (issue #254): never queries "latest" rows (no
    ``order_by(created_at.desc()).first()``), so concurrent/tool-call turns
    cannot overwrite each other's history. The SyncMessage write keeps the
    ``conv.source == "android_client"`` gate.

    Runs under ``get_db_session`` (T3 transaction rule: the context owns the
    commit, no inner commits). Returns True when the owned row was found.
    """
    if not experience_id or not conversation_id:
        return False
    with get_db_session() as session:
        exp = session.query(Experience).filter_by(id=experience_id).first()
        if exp is None:
            # Turn-start row missing — write a replacement so the turn is
            # never silently lost.
            if full_response:
                session.add(Experience(
                    conversation_id=conversation_id,
                    user_query=user_query,
                    agent_response=full_response,
                ))
            found = False
        else:
            if full_response:
                exp.agent_response = full_response
            found = True

        conv = session.query(Conversation).filter_by(id=conversation_id).first()
        if conv is not None and conv.source == "android_client" and full_response:
            sync_msg = SyncMessage(
                id=generate_ulid(),
                conversation_id=conversation_id,
                role="assistant",
                content=full_response,
                provider="cloud",
                created_at=int(time.time() * 1000)
            )
            session.add(sync_msg)
    return found

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
        normalized_id = None
        full_response = ""
        initial_message = payload.message
        experience_id = None
        persisted = False
        released = False

        def _release_once(reason: str) -> None:
            nonlocal released
            if released:
                return
            released = True
            try:
                semaphore.release()
            except ValueError:
                pass
            logger.info("Semaphore released", thread_id=normalized_id, reason=reason)

        async def _persist_once(reason: str) -> None:
            """Shielded exactly-once turn persistence.

            Runs the blocking DB write in a worker thread under
            asyncio.shield(), so a client disconnect (cancel/close) cannot
            drop the Experience/SyncMessage rows: the thread keeps running
            to commit even if the waiter is cancelled.
            """
            nonlocal persisted
            if persisted or not experience_id:
                return
            persisted = True
            try:
                await asyncio.shield(
                    asyncio.to_thread(
                        _persist_sse_turn_sync,
                        experience_id,
                        normalized_id,
                        initial_message,
                        full_response,
                    )
                )
                logger.info("Experience turn persisted", conversation_id=normalized_id, reason=reason)
            except BaseException as e:
                logger.error("Failed to persist experience turn", error=str(e))
                if isinstance(e, asyncio.CancelledError):
                    raise

        try:
            # Retrieve or create thread
            normalized_id = normalize_thread_id(payload.thread_id)

            with get_db_session() as session:
                client = DBClient(session)
                conv = session.query(Conversation).filter_by(id=normalized_id).first()
                if not conv:
                    conv = client.create_client_conversation(agent=payload.agent, conversation_id=normalized_id)
                else:
                    if payload.agent != conv.agent:
                        conv.agent = payload.agent
                thread_uuid = conv.id
                thread_title = conv.title
                thread_agent = conv.agent

            # T6 (issue #254): create the Experience row at turn start so the
            # turn owns its row by ID. T3 transaction rule: flush-only here,
            # get_db_session owns the commit.
            try:
                with get_db_session() as session:
                    exp_client = DBClient(session)
                    exp_row = exp_client.save_experience(
                        conversation_id=thread_uuid,
                        user_query=initial_message,
                        agent_response="",
                    )
                    experience_id = exp_row.id
            except Exception as e:
                logger.error("Failed to create experience row at turn start", error=str(e))
                experience_id = None

            initial_state = {
                "messages": [HumanMessage(content=payload.message)],
                "db_conv_id": thread_uuid,
                "next_node": "supervisor",
                "agent": thread_agent
            }
            if experience_id is not None:
                initial_state["experience_id"] = experience_id

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
                                create_background_task(evaluate_webview_session(active_session.id))
                    except Exception as ex:
                        logger.error("Failed to trigger webview session evaluation", error=str(ex))

            producer_task = create_background_task(producer())

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
                    node = event.get("metadata", {}).get("langgraph_node")
                    if kind == "on_chat_model_stream":
                        # Only stream tokens from the chatbot node to the client.
                        # Suppress internal supervisor classification JSON or intermediate prompts.
                        if node and node != "chatbot":
                            continue
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
                        if tool_name == "webview_browser" or tool_name.startswith("device_"):
                            import tools.pending_tasks
                            conv_id = tool_input.get("conversation_id")
                            if conv_id:
                                task_token = str(uuid.uuid4())
                                tools.pending_tasks.LAST_TOOL_START_TOKENS[conv_id] = task_token
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
                # T6: disconnect must not drop the turn — shielded persist
                # before propagating the cancellation.
                await _persist_once("client-disconnect")
                raise
            finally:
                # We let the producer_task continue running to completion in the background
                # so the agent can finish processing and write the result to the database.
                logger.info("SSE generator finished", thread_id=normalized_id)
                # Release semaphore as soon as streaming is complete so new streams
                # can start while post-processing (DB writes, title generation) happens.
                _release_once("streaming-complete")

            # Success path: update the owned Experience row by ID (never the
            # "latest" row). Shielded so a late disconnect cannot drop it.
            await _persist_once("stream-complete")

            # Generate a dynamic title if thread title is 'New Chat'
            if thread_title == "New Chat":
                # new_title = payload.message[:30] + "..." if len(payload.message) > 30 else payload.message
                response = await asyncio.to_thread(get_title, initial_message)
                new_title = str(response.content) if hasattr(response, "content") else str(response)
                with get_db_session() as session:
                    client = DBClient(session)
                    client.update_conversation_title(thread_uuid, new_title)
                title_to_send = new_title
            else:
                title_to_send = thread_title

            # Send final completed event
            yield f"data: {json.dumps({'type': 'done', 'thread_title': title_to_send, 'agent': thread_agent})}\n\n"
        except BaseException:
            # Release the semaphore exactly once if streaming failed before
            # the inner finally above (e.g. setup failure, GeneratorExit on
            # close, or any other unexpected error), and make a best-effort
            # shielded persist attempt on error paths (no-op if the turn was
            # already persisted). Never yields — safe under GeneratorExit.
            _release_once("error-handler")
            try:
                await _persist_once("error-path")
            except BaseException:
                pass
            raise

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
            "X-Accel-Buffering": "no",
        },
    )


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
            
            new_conv = Conversation(id=new_id, title=payload.title[:255], agent=parent_conv.agent, source=parent_conv.source)
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
            # Capture cutoff before deletes (avoid read-after-delete on expired object).
            target_created_at = target_exp.created_at
            threshold_ms = int(target_created_at.replace(tzinfo=timezone.utc).timestamp() * 1000)

            session.query(Experience).filter(
                Experience.conversation_id == normalized_id,
                Experience.created_at >= target_created_at
            ).delete(synchronize_session=False)

            # Prune sync rows at/after the cut so a later sync_pull cannot
            # resurrect truncated messages (wayfinder T4, issue #252).
            # SyncMessage.created_at is epoch-ms while Experience.created_at
            # is naive UTC datetime (T3 rule), hence the conversion.
            session.query(SyncMessage).filter(
                SyncMessage.conversation_id == normalized_id,
                SyncMessage.created_at >= threshold_ms
            ).delete(synchronize_session=False)

            conv = session.query(Conversation).filter_by(id=normalized_id).first()
            if conv:
                conv.updated_at = utcnow_naive()

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

            token_data = {
                "access_token": payload.access_token,
                "refresh_token": payload.refresh_token,
                "expiry": payload.expiry,
                "scopes": payload.scopes,
            }
            client.store_oauth_token(payload.conversation_id, "google", token_data)

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

            token_record = dbc.get_oauth_token(GLOBAL_OAUTH_CONVERSATION_ID, "google")

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
                "access_token": "[REDACTED]" if token_data.get("access_token") else "",
                "refresh_token": "[REDACTED]" if token_data.get("refresh_token") else "",
                "id_token": "[REDACTED]" if token_data.get("id_token") else "",
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
    conversation_id = GLOBAL_OAUTH_CONVERSATION_ID
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

    try:
        stored = db.store_oauth_tokens(GLOBAL_OAUTH_CONVERSATION_ID, "google", token_record)
        if stored is False:
            raise RuntimeError("store_oauth_tokens returned False")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to store OAuth tokens", error=str(e), conversation_id=GLOBAL_OAUTH_CONVERSATION_ID)
        raise HTTPException(status_code=500, detail="Failed to store OAuth tokens")
    logger.info("OAuth tokens stored", conversation_id=GLOBAL_OAUTH_CONVERSATION_ID)

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
    # T8 multi-worker: local PENDING_TASKS first, DB mailbox fallback so a
    # response landing on a different worker is accepted (no 404) and picked
    # up by the waiting worker's poll. Still 404s when no waiter exists.
    from tools.pending_tasks import submit_cross_worker_response
    key = submit_cross_worker_response(
        payload.conversation_id, payload.status, payload.result
    )
    if key:
        pending_tasks = get_pending_tasks()
        if key in pending_tasks:
            _safe_set_event(pending_tasks[key])
        logger.info("Received WebView response for task", conversation_id=payload.conversation_id, status=payload.status)
        return {"status": "accepted"}
    else:
        logger.warning("Received WebView response but no pending task found", conversation_id=payload.conversation_id)
        raise HTTPException(status_code=404, detail="No pending task found for this conversation ID")

class DeviceResponsePayload(BaseModel):
    conversation_id: str
    status: str
    result: str
    task_token: Optional[str] = None

@app.post("/chat/device/response", dependencies=[Depends(verify_api_key)])
def submit_device_response(payload: DeviceResponsePayload):
    # T8 multi-worker: same local-first + DB mailbox fallback as webview.
    from tools.pending_tasks import submit_cross_worker_response
    key = submit_cross_worker_response(
        payload.conversation_id, payload.status, payload.result,
        task_token=payload.task_token,
    )
    if key:
        pending_tasks = get_pending_tasks()
        if key in pending_tasks:
            _safe_set_event(pending_tasks[key])
        logger.info("Received Device response for task", conversation_id=payload.conversation_id, status=payload.status)
        return {"status": "accepted"}
    else:
        logger.warning("Received Device response but no pending task found", conversation_id=payload.conversation_id)
        raise HTTPException(status_code=404, detail="No pending task found for this conversation ID")

@app.post("/consolidate", dependencies=[Depends(verify_api_key)])
def trigger_consolidation():
    logger.info("Triggering nightly self-improvement consolidation loop and daily briefing")
    msg = run_self_improvement()
    briefing_result = run_daily_briefing()
    logger.info("Consolidation loop completed", result=msg, briefing=briefing_result)
    return {"status": "success", "consolidation": msg, "briefing": briefing_result}


# ---------------------------------------------------------------------------
# Daily Briefings & Watch List Endpoints
# ---------------------------------------------------------------------------

class WatchItemPayload(BaseModel):
    text: str
    date_hint: Optional[str] = None


@app.get("/api/briefing/config", dependencies=[Depends(verify_api_key)])
def get_briefing_config():
    with get_db_session() as session:
        client = DBClient(session)
        return client.get_briefing_config()


@app.put("/api/briefing/config", dependencies=[Depends(verify_api_key)])
def update_briefing_config(payload: dict):
    with get_db_session() as session:
        client = DBClient(session)
        return client.update_briefing_config(payload)


@app.post("/api/briefings/watch", dependencies=[Depends(verify_api_key)])
def add_watch_item(payload: WatchItemPayload):
    with get_db_session() as session:
        client = DBClient(session)
        return client.add_watch_item(text=payload.text, date_hint=payload.date_hint)


@app.delete("/api/briefings/watch/{item_id}", dependencies=[Depends(verify_api_key)])
def delete_watch_item(item_id: str):
    with get_db_session() as session:
        client = DBClient(session)
        success = client.delete_watch_item(item_id)
        if not success:
            raise HTTPException(status_code=404, detail="Watch item not found")
        return {"status": "ok", "deleted_id": item_id}


@app.get("/api/briefings", dependencies=[Depends(verify_api_key)])
def get_briefings(days: int = Query(14)):
    with get_db_session() as session:
        client = DBClient(session)
        briefings = client.get_briefing_history(days=days)
        return [
            {
                "id": b.id,
                "user_id": b.user_id,
                "date": b.date,
                "summary_text": b.summary_text,
                "sections_json": b.sections_json,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in briefings
        ]


# ---------------------------------------------------------------------------
# Daily check-ins (wayfinder #115)
# ---------------------------------------------------------------------------

class CheckInPayload(BaseModel):
    conversation_id: UUID
    mood: int = Field(ge=1, le=5)
    energy: int = Field(ge=1, le=5)
    win: Optional[str] = None
    carrying: Optional[str] = None
    note: Optional[str] = None
    date: Optional[dt_date] = None
    source: Optional[str] = "android_client"


def _serialize_checkin(c):
    return {
        "id": c.id,
        "conversation_id": c.conversation_id,
        "date": c.date,
        "mood": c.mood,
        "energy": c.energy,
        "win": c.win,
        "carrying": c.carrying,
        "note": c.note,
        "source": c.source,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _distill_checkin_memory(conversation_id: str, date: str, win: Optional[str], carrying: Optional[str], note: Optional[str]) -> None:
    """Distills salient check-in facts into semantic memory.

    Numeric-only scores stay local; win/carrying/note are saved verbatim.
    Accesses the tool via module attribute so tests can monkeypatch it.
    """
    facts: list[str] = []
    if win and win.strip():
        facts.append(f"Check-in {date}: win - {win.strip()}")
    if carrying and carrying.strip():
        facts.append(f"Check-in {date}: carrying - {carrying.strip()}")
    if note and note.strip():
        facts.append(f"Check-in {date}: note - {note.strip()}")
    if not facts:
        return
    try:
        import tools.memory as memory_tools

        saver = memory_tools.save_user_memory
        func = getattr(saver, "func", None) or saver
        for fact in facts:
            func(conversation_id, fact)
    except Exception as e:
        logger.error("Failed to distill check-in memory", error=str(e))


@app.post("/api/checkins", dependencies=[Depends(verify_api_key)])
def post_checkin(payload: CheckInPayload):
    conversation_id = str(payload.conversation_id)
    checkin_date = payload.date.isoformat() if payload.date else datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with get_db_session() as session:
        client = DBClient(session)
        if not session.query(Conversation).filter_by(id=conversation_id).first():
            client.create_client_conversation(conversation_id=conversation_id)
        checkin = client.upsert_checkin(
            conversation_id=conversation_id,
            date=checkin_date,
            mood=payload.mood,
            energy=payload.energy,
            win=payload.win,
            carrying=payload.carrying,
            note=payload.note,
            source=payload.source or "android_client",
        )
        result = _serialize_checkin(checkin)
    _distill_checkin_memory(conversation_id, checkin_date, payload.win, payload.carrying, payload.note)
    return result


@app.get("/api/checkins", dependencies=[Depends(verify_api_key)])
def list_checkins(conversation_id: Optional[str] = Query(None), days: int = Query(14, ge=1)):
    with get_db_session() as session:
        client = DBClient(session)
        entries = client.get_checkins(conversation_id=conversation_id, days=days)
        return [_serialize_checkin(e) for e in entries]


@app.get("/api/checkins/summary", dependencies=[Depends(verify_api_key)])
def get_checkins_summary(conversation_id: Optional[str] = Query(None), days: int = Query(14, ge=1)):
    with get_db_session() as session:
        client = DBClient(session)
        entries = client.get_checkins(conversation_id=conversation_id, days=days)
        count = len(entries)
        if count == 0:
            return {"count": 0, "summary": "No check-ins in this window yet.", "avg_mood": None, "avg_energy": None}
        avg_mood = round(sum(e.mood for e in entries) / count, 2)
        avg_energy = round(sum(e.energy for e in entries) / count, 2)
        wins = [e.win for e in entries if e.win]
        carrying = [e.carrying for e in entries if e.carrying]
        lines = [f"{count} check-in(s) in the last {days} days. Avg mood {avg_mood}/5, avg energy {avg_energy}/5."]
        if wins:
            lines.append(f"Wins: {'; '.join(wins[:3])}")
        if carrying:
            lines.append(f"Carrying: {'; '.join(carrying[:3])}")
        return {"count": count, "summary": " ".join(lines), "avg_mood": avg_mood, "avg_energy": avg_energy}


# ---------------------------------------------------------------------------
# Tool Proxy and Sync Endpoints for Local LLM Integration
# ---------------------------------------------------------------------------

from collections import defaultdict
import time

RATE_LIMIT_STORE = defaultdict(list)

# Optional Redis backing for the tool-proxy rate limiter (wayfinder T8).
# Flag-guarded: REDIS_URL unset (default) keeps the process-local sliding
# window below with zero new infra. Without Redis each worker enforces
# 10 req/min locally, so the cluster-wide effective limit scales with the
# worker count — deploy behind sticky-affinity (or set REDIS_URL) when exact
# global enforcement matters. Redis failures always fall back to local.
_redis_rate_state = {"attempted": False, "client": None}


def _get_redis_client():
    if _redis_rate_state["attempted"]:
        return _redis_rate_state["client"]
    _redis_rate_state["attempted"] = True
    url = os.getenv("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis
        client = redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        _redis_rate_state["client"] = client
        logger.info("Tool-proxy rate limiting via Redis")
    except Exception as e:
        logger.warning("Redis unavailable, using local rate-limit fallback", error=str(e))
        _redis_rate_state["client"] = None
    return _redis_rate_state["client"]


def check_rate_limit(api_key: str) -> bool:
    rc = _get_redis_client()
    if rc is not None:
        try:
            minute = int(time.time() // 60)
            rkey = f"vela:ratelimit:{api_key}:{minute}"
            count = rc.incr(rkey)
            if count == 1:
                rc.expire(rkey, 65)
            return count <= 10
        except Exception:
            pass  # fall through to the local single-worker fallback
    now = time.time()
    RATE_LIMIT_STORE[api_key] = [t for t in RATE_LIMIT_STORE[api_key] if now - t < 60]
    if len(RATE_LIMIT_STORE[api_key]) >= 10:
        return False
    RATE_LIMIT_STORE[api_key].append(now)
    return True


@app.get("/api/tools/manifest", dependencies=[Depends(verify_api_key)])
def get_tools_manifest(
    response: Response,
    agent_id: str = Query(..., description="The ID of the Agent"),
    conversation_id: Optional[str] = Query(None, description="Optional conversation UUID")
):
    agent_config = AGENT_REGISTRY.get(agent_id)
    if not agent_config:
        raise HTTPException(status_code=400, detail="Unknown agent_id")

    tool_names = agent_config.tool_names[:3]

    manifest_tools = []
    from tools import tools_list
    for name in tool_names:
        t = next((tool for tool in tools_list if tool.name == name), None)
        if t:
            manifest_tools.append({
                "name": t.name,
                "description": t.description,
                "parameters": t.args
            })

    response.headers["Cache-Control"] = "max-age=300"
    return {
        "tools": manifest_tools,
        "max_tools_hint": 3
    }


class ToolInvokePayload(BaseModel):
    conversation_id: str
    tool_name: str
    arguments: dict = Field(default_factory=dict)
    request_id: str


@app.post("/api/tools/invoke")
async def invoke_tool(
    payload: ToolInvokePayload,
    api_key: str = Depends(verify_api_key)
):
    if not check_rate_limit(api_key):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Max 10 calls/min.")

    from tools import tools_list
    t = next((tool for tool in tools_list if tool.name == payload.tool_name), None)
    if not t:
        return {
            "request_id": payload.request_id,
            "tool_name": payload.tool_name,
            "status": "error",
            "error": {
                "code": "UNKNOWN_TOOL",
                "message": f"Tool '{payload.tool_name}' not found."
            }
        }

    with get_db_session() as session:
        existing = session.query(ToolInvocation).filter_by(request_id=payload.request_id).first()
        if existing:
            if existing.status == "success":
                return {
                    "request_id": existing.request_id,
                    "tool_name": existing.tool_name,
                    "status": "success",
                    "result": existing.result
                }
            else:
                return {
                    "request_id": existing.request_id,
                    "tool_name": existing.tool_name,
                    "status": "error",
                    "error": {
                        "code": "EXECUTION_ERROR",
                        "message": existing.result
                    }
                }

    with get_db_session() as session:
        new_inv = ToolInvocation(
            request_id=payload.request_id,
            tool_name=payload.tool_name,
            status="running"
        )
        session.add(new_inv)

    from fastapi.concurrency import run_in_threadpool
    import asyncio

    status_res = "success"
    error_data = None
    result_str = ""

    try:
        ans = await asyncio.wait_for(
            run_in_threadpool(t.invoke, payload.arguments),
            timeout=60.0
        )
        if isinstance(ans, dict) and "error" in ans:
            status_res = "error"
            err_val = ans["error"]
            if isinstance(err_val, Exception):
                result_str = str(err_val)
            elif isinstance(err_val, dict) and "message" in err_val:
                result_str = err_val["message"]
            else:
                result_str = str(err_val)
            error_data = {
                "code": "EXECUTION_ERROR",
                "message": result_str
            }
        elif isinstance(ans, Exception):
            status_res = "error"
            result_str = str(ans)
            error_data = {
                "code": "EXECUTION_ERROR",
                "message": result_str
            }
        else:
            result_str = str(ans)
    except asyncio.TimeoutError:
        status_res = "error"
        result_str = "Timeout: tool execution exceeded 60 seconds."
        error_data = {
            "code": "TIMEOUT",
            "message": result_str
        }
    except Exception as e:
        status_res = "error"
        result_str = str(e)
        error_data = {
            "code": "EXECUTION_ERROR",
            "message": result_str
        }

    with get_db_session() as session:
        inv = session.query(ToolInvocation).filter_by(request_id=payload.request_id).first()
        if inv:
            inv.status = status_res
            inv.result = result_str

    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=payload.conversation_id).first()
        if conv and conv.source == "android_client":
            sync_msg = SyncMessage(
                id=generate_ulid(),
                conversation_id=payload.conversation_id,
                role="tool",
                content=result_str,
                provider="cloud",
                created_at=int(time.time() * 1000)
            )
            session.add(sync_msg)

    if status_res == "success":
        return {
            "request_id": payload.request_id,
            "tool_name": payload.tool_name,
            "status": "success",
            "result": result_str
        }
    else:
        return {
            "request_id": payload.request_id,
            "tool_name": payload.tool_name,
            "status": "error",
            "error": error_data
        }


class SyncOperation(BaseModel):
    id: str  # ULID
    type: str  # "message"
    conversation_id: str
    payload: dict


class SyncPushPayload(BaseModel):
    operations: list[SyncOperation] = Field(default_factory=list)


@app.post("/api/sync/push", dependencies=[Depends(verify_api_key)])
def sync_push(payload: SyncPushPayload):
    accepted = []
    rejected = []
    latest_ulid = None

    with get_db_session() as session:
        client = DBClient(session)
        for op in payload.operations:
            if op.type != "message":
                rejected.append(op.id)
                continue

            try:
                # Per-item SAVEPOINT (wayfinder T4, issue #252): a poison op
                # rolls back to here without discarding the rest of the batch,
                # and the client can retry just the rejected ids idempotently.
                # This is a SAVEPOINT, not a commit — the outer get_db_session
                # still owns the single final commit (T3 rule, issue #251).
                with session.begin_nested():
                    conv = session.query(Conversation).filter_by(id=op.conversation_id).first()
                    if not conv:
                        # Auto-create the conversation for local-first offline sync:
                        # a thread created entirely on the device has no backend
                        # counterpart until its first flush.
                        conv = client.create_client_conversation(
                            title="Synced Conversation",
                            agent="personal assistant",
                            conversation_id=op.conversation_id,
                            source="android_client"
                        )
                    if conv.source != "android_client":
                        op_ok = False
                    else:
                        existing = session.query(SyncMessage).filter_by(id=op.id).first()
                        if existing and existing.conversation_id != op.conversation_id:
                            # Global PK collision: the caller's ID already belongs
                            # to another conversation — reject, never overwrite
                            # or misattribute it (coderabbit #260).
                            op_ok = False
                        else:
                            if not existing:
                                role = op.payload.get("role", "")
                                content = op.payload.get("content", "")
                                provider = op.payload.get("provider", "")
                                created_at = op.payload.get("created_at")

                                if created_at is None:
                                    created_at = int(time.time() * 1000)

                                new_msg = SyncMessage(
                                    id=op.id,
                                    conversation_id=op.conversation_id,
                                    role=role,
                                    content=content,
                                    provider=provider,
                                    created_at=int(created_at)
                                )
                                session.add(new_msg)
                            session.flush()
                            op_ok = True
            except HTTPException:
                raise
            except Exception as e:
                logger.error("sync_push rejected poisoned op", op_id=op.id, error=str(e))
                rejected.append(op.id)
                continue

            if op_ok:
                accepted.append(op.id)
                latest_ulid = max(latest_ulid, op.id) if latest_ulid else op.id
            else:
                rejected.append(op.id)

    return {
        "accepted": accepted,
        "rejected": rejected,
        "server_cursor": latest_ulid
    }


@app.get("/api/sync/pull", dependencies=[Depends(verify_api_key)])
def sync_pull(
    cursor: Optional[str] = Query(None, description="The last known server ULID"),
    limit: int = Query(50, description="The maximum number of items to return")
):
    with get_db_session() as session:
        android_convs = session.query(Conversation).filter_by(source="android_client").all()
        android_conv_ids = [c.id for c in android_convs]

        if not android_conv_ids:
            return {
                "operations": [],
                "cursor": cursor,
                "has_more": False
            }

        query = session.query(SyncMessage).filter(
            SyncMessage.conversation_id.in_(android_conv_ids),
            SyncMessage.provider != "android_client"
        )

        if cursor:
            query = query.filter(SyncMessage.id > cursor)

        messages = query.order_by(SyncMessage.id.asc()).limit(limit + 1).all()

        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]

        latest_ulid = messages[-1].id if messages else cursor

        operations = []
        for msg in messages:
            operations.append({
                "id": msg.id,
                "type": "message",
                "conversation_id": msg.conversation_id,
                "payload": {
                    "role": msg.role,
                    "content": msg.content,
                    "provider": msg.provider,
                    "created_at": msg.created_at
                }
            })

    return {
        "operations": operations,
        "cursor": latest_ulid,
        "has_more": has_more
    }

class TaskRunPayload(BaseModel):
    task_id: str
    title: str
    prompt: str
    agent: str = Field(default="personal assistant")


class DeviceStepEvent(BaseModel):
    id: str
    role: str = "assistant"
    content: Optional[str] = None
    tool_name: Optional[str] = None
    target: Optional[str] = None
    value: Optional[str] = None
    status: str = "executed"
    observation: Optional[str] = None
    timestamp: Optional[int] = None


class DeviceStepsSyncPayload(BaseModel):
    conversation_id: str
    client_sync_id: Optional[str] = None
    events: list[DeviceStepEvent] = Field(default_factory=list, max_length=100)


@app.post("/api/sync/device-steps", dependencies=[Depends(verify_api_key)])
def sync_device_steps(payload: DeviceStepsSyncPayload):
    accepted: list[str] = []
    rejected: list[str] = []

    with get_db_session() as session:
        client = DBClient(session)
        conv = session.query(Conversation).filter_by(id=payload.conversation_id).first()
        if not conv:
            conv = client.create_client_conversation(
                title="Synced Device Steps",
                agent="personal assistant",
                conversation_id=payload.conversation_id,
                source="android_client",
            )
        elif conv.source != "android_client":
            # Raised before any writes: get_db_session rolls the untouched
            # transaction back and re-raises, so FastAPI returns a clean 400
            # with no broken-transaction state left behind.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot sync device steps to non-client conversation",
            )

        for ev in payload.events:
            if not ev.id:
                rejected.append(ev.id or "missing_id")
                continue

            try:
                # Per-item SAVEPOINT (wayfinder T4, issue #252): same contract
                # as sync_push — one poison event must not discard the batch.
                # SAVEPOINT only; final commit stays with get_db_session (T3).
                with session.begin_nested():
                    # 1. Idempotent upsert into SyncMessage
                    msg_content = ev.content or (
                        f"[{ev.status.upper()}] {ev.tool_name or 'action'}: {ev.observation or ''}"
                    )
                    existing_msg = session.query(SyncMessage).filter_by(id=ev.id).first()
                    if existing_msg and existing_msg.conversation_id != payload.conversation_id:
                        # Global PK collision across conversations — reject via
                        # the per-item savepoint handler (coderabbit #260).
                        raise ValueError("SyncMessage ID belongs to another conversation")
                    if not existing_msg:
                        created_ts = ev.timestamp or int(datetime.now(timezone.utc).timestamp() * 1000)
                        new_msg = SyncMessage(
                            id=ev.id,
                            conversation_id=payload.conversation_id,
                            role=ev.role or "assistant",
                            content=msg_content,
                            provider="android_client",
                            created_at=int(created_ts),
                        )
                        session.add(new_msg)
                    else:
                        existing_msg.content = msg_content

                    # 2. Idempotent upsert into ToolInvocation if tool_name is present
                    if ev.tool_name:
                        existing_tool = session.query(ToolInvocation).filter_by(request_id=ev.id).first()
                        if not existing_tool:
                            tool_inv = ToolInvocation(
                                request_id=ev.id,
                                tool_name=ev.tool_name,
                                status=ev.status or "executed",
                                result=ev.observation,
                                created_at=utcnow_naive(),
                            )
                            session.add(tool_inv)
                        else:
                            existing_tool.status = ev.status or "executed"
                            existing_tool.result = ev.observation
                    session.flush()
            except HTTPException:
                raise
            except Exception as e:
                logger.error("sync_device_steps rejected poisoned event", event_id=ev.id, error=str(e))
                rejected.append(ev.id)
                continue

            accepted.append(ev.id)

    return {
        "status": "ok",
        "conversation_id": payload.conversation_id,
        "accepted": accepted,
        "rejected": rejected,
        "processed": len(accepted),
    }


@app.post("/api/tasks/run", dependencies=[Depends(verify_api_key)])
async def execute_task_run(payload: TaskRunPayload):
    allowed_agents = [config.identifier for config in AGENT_REGISTRY.list_agents()]
    if payload.agent not in allowed_agents:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported agent: '{payload.agent}'. Supported agents are: {allowed_agents}"
        )
    
    initial_state = {
        "messages": [HumanMessage(content=payload.prompt)],
        "next_node": "supervisor",
        "agent": payload.agent
    }
    
    full_text = ""
    try:
        async for event in graph.astream_events(initial_state, version="v2"):
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
                    elif isinstance(content, str):
                        content_str = content
                    else:
                        content_str = str(content)
                    
                    if content_str:
                        full_text += content_str
        
        return {"status": "success", "output": full_text}
    except Exception as e:
        logger.error("Error executing background task flow", error=str(e))
        return {"status": "failed", "output": str(e)}

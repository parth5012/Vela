"""T6 (issue #254): SSE disconnect persistence + Experience turn lifecycle.

- Abort SSE mid-stream -> Experience + SyncMessage rows still exist.
- Tool-call turns reuse their owned row by ID; prior turns are untouched.
- Semaphore released exactly once on success/cancel/error.
"""
import asyncio
import uuid
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage

from agent import concurrency


def _unique_id(prefix):
    return f"{prefix}-{uuid.uuid4()}"


def _cleanup_conv(norm_id):
    from db.models import Conversation, Experience, SyncMessage
    from db.session import get_db_session

    with get_db_session() as session:
        session.query(SyncMessage).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
        session.query(Experience).filter_by(conversation_id=norm_id).delete(synchronize_session=False)
        session.query(Conversation).filter_by(id=norm_id).delete(synchronize_session=False)


async def _cancel_background_tasks():
    import agent.main as m

    for task in list(m.BACKGROUND_TASKS):
        if not task.done():
            task.cancel()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_abort_midstream_persists_experience_and_sync():
    import agent.main as m
    from db.client import DBClient
    from db.models import Experience, SyncMessage
    from db.session import get_db_session

    concurrency._semaphore = None
    sem = concurrency.get_stream_semaphore()
    limit = sem._value

    thread_id = _unique_id("t6-disc")
    norm_id = m.normalize_thread_id(thread_id)
    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="T6 disconnect", agent="personal assistant",
            conversation_id=norm_id, source="android_client",
        )

    async def slow_stream(*args, **kwargs):
        yield {
            "event": "on_chat_model_stream",
            "metadata": {"langgraph_node": "chatbot"},
            "data": {"chunk": AIMessageChunk(content="part-one ")},
        }
        await asyncio.sleep(30)  # client disconnects while we wait
        yield {
            "event": "on_chat_model_stream",
            "metadata": {"langgraph_node": "chatbot"},
            "data": {"chunk": AIMessageChunk(content="part-two")},
        }

    try:
        with patch.object(m.graph, "astream_events", side_effect=slow_stream):
            resp = await m.chat_message(
                m.MessagePayload(thread_id=thread_id, message="hello t6", agent="personal assistant")
            )
            it = resp.body_iterator
            first = await it.__anext__()
            assert "part-one" in first
            await it.aclose()  # simulate client disconnect
            await asyncio.sleep(0.5)  # let shielded persist land

        with get_db_session() as session:
            exps = session.query(Experience).filter_by(conversation_id=norm_id).all()
            assert len(exps) == 1
            assert "part-one" in (exps[0].agent_response or "")
            syncs = session.query(SyncMessage).filter_by(conversation_id=norm_id).all()
            assert len(syncs) == 1
            assert "part-one" in syncs[0].content

        assert sem._value == limit  # released exactly once
    finally:
        await _cancel_background_tasks()
        concurrency._semaphore = None
        _cleanup_conv(norm_id)


@pytest.mark.asyncio
async def test_success_persists_single_row_and_single_sync():
    import agent.main as m
    from db.client import DBClient
    from db.models import Experience, SyncMessage
    from db.session import get_db_session

    concurrency._semaphore = None
    sem = concurrency.get_stream_semaphore()
    limit = sem._value

    thread_id = _unique_id("t6-ok")
    norm_id = m.normalize_thread_id(thread_id)
    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="T6 success", agent="personal assistant",
            conversation_id=norm_id, source="android_client",
        )

    async def quick_stream(*args, **kwargs):
        yield {
            "event": "on_chat_model_stream",
            "metadata": {"langgraph_node": "chatbot"},
            "data": {"chunk": AIMessageChunk(content="hello ")},
        }
        yield {
            "event": "on_chat_model_stream",
            "metadata": {"langgraph_node": "chatbot"},
            "data": {"chunk": AIMessageChunk(content="world")},
        }

    try:
        with patch.object(m.graph, "astream_events", side_effect=quick_stream):
            resp = await m.chat_message(
                m.MessagePayload(thread_id=thread_id, message="hi t6", agent="personal assistant")
            )
            chunks = [c async for c in resp.body_iterator]

        assert any('"done"' in c for c in chunks)

        with get_db_session() as session:
            exps = session.query(Experience).filter_by(conversation_id=norm_id).all()
            assert len(exps) == 1
            assert exps[0].agent_response == "hello world"
            syncs = session.query(SyncMessage).filter_by(conversation_id=norm_id).all()
            assert len(syncs) == 1
            assert syncs[0].content == "hello world"

        assert sem._value == limit
    finally:
        await _cancel_background_tasks()
        concurrency._semaphore = None
        _cleanup_conv(norm_id)


@pytest.mark.asyncio
async def test_tool_call_turn_does_not_clobber_prior_turn(monkeypatch):
    # Force the real LLM branch of chatbot_node (mock mode ignores get_llm).
    monkeypatch.setenv("GOOGLE_API_KEY", "AIzaFakeKeyForT6Test")
    from agent.graph import chatbot_node
    from db.client import DBClient
    from db.models import Experience
    from db.session import get_db_session

    conv_id = _unique_id("t6-turn")
    with get_db_session() as session:
        DBClient(session).create_client_conversation(
            title="T6 turns", agent="personal assistant", conversation_id=conv_id,
        )

    def _llm_with(chunks):
        mock_llm = MagicMock()
        bound = MagicMock()

        async def _astream(*args, **kwargs):
            for c in chunks:
                yield c

        bound.astream = _astream
        mock_llm.bind_tools.return_value = bound
        return mock_llm

    try:
        with patch("agent.graph.build_system_prompt", return_value="sys"):
            # Turn 1: plain final answer -> owns row 1.
            with patch("agent.graph.get_llm", return_value=_llm_with([AIMessageChunk(content="first answer")])):
                r1 = await chatbot_node({
                    "messages": [HumanMessage(content="q1")],
                    "db_conv_id": conv_id,
                    "agent": "personal assistant",
                })
            assert r1.get("experience_id")

            # Turn 2: tool-call invocation creates its own row, final
            # invocation reuses it by ID (never touches row 1).
            tool_chunk = AIMessageChunk(
                content="",
                tool_calls=[{"name": "t", "args": {}, "id": "c1", "type": "tool_call"}],
            )
            with patch("agent.graph.get_llm", return_value=_llm_with([tool_chunk])):
                r2a = await chatbot_node({
                    "messages": [HumanMessage(content="q2")],
                    "db_conv_id": conv_id,
                    "agent": "personal assistant",
                })
            assert r2a.get("experience_id")
            assert r2a["experience_id"] != r1["experience_id"]

            with patch("agent.graph.get_llm", return_value=_llm_with([AIMessageChunk(content="second answer")])):
                r2b = await chatbot_node({
                    "messages": [HumanMessage(content="q2")],
                    "db_conv_id": conv_id,
                    "agent": "personal assistant",
                    "experience_id": r2a["experience_id"],
                })
            assert r2b["experience_id"] == r2a["experience_id"]

        with get_db_session() as session:
            rows = (
                session.query(Experience)
                .filter_by(conversation_id=conv_id)
                .order_by(Experience.created_at)
                .all()
            )
            assert len(rows) == 2
            assert rows[0].agent_response == "first answer"
            assert rows[1].user_query == "q2"
            assert rows[1].agent_response == "second answer"
    finally:
        _cleanup_conv(conv_id)

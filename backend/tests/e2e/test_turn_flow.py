"""Comprehensive end-to-end turn flow tests for Vela backend.

Exercises the real FastAPI app (routes, middleware, auth gates, streaming generator,
and database persistence) with FakeProvider and seeded DB — deterministic HTTP-e2e,
no external network calls, no live LLM.
"""

from __future__ import annotations

import uuid
from typing import Any

from langchain_core.messages import SystemMessage
from pydantic import BaseModel

from agent.spec import (
    ContentSSEEvent,
    DoneSSEEvent,
    ErrorSSEEvent,
    validate_sse_line,
)
from agent.testing.provider import ScriptedToolCall
from db.client import DBClient
from db.models import (
    Conversation,
    Experience,
    SyncMessage,
    SystemPromptFragment,
)
from db.session import get_db_session


def _collect_sse_events(response: Any) -> list[BaseModel]:
    """Consume an SSE response stream and validate every non-empty line."""
    events: list[BaseModel] = []
    for line in response.iter_lines():
        if not line or line.startswith(":"):
            continue
        event = validate_sse_line(line)
        events.append(event)
    return events


# ===========================================================================
# 1. Single-Turn Streaming & Persistence
# ===========================================================================


def test_e2e_single_turn_streaming_and_persistence(deterministic_app):
    """POST /chat/message streams tokens as ContentSSEEvents and ends with DoneSSEEvent,

    persisting the turn in the Experience table.
    """
    thread_id = deterministic_app.seeded_data.thread_id
    tokens = ["Hello! ", "I am Vela, ", "your AI assistant."]
    deterministic_app.provider.add_turn(tokens)

    payload = {"thread_id": thread_id, "message": "Hi Vela"}
    with deterministic_app.stream("POST", "/chat/message", json=payload) as resp:
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        events = _collect_sse_events(resp)

    assert len(events) >= 4
    content_events = [e for e in events if isinstance(e, ContentSSEEvent)]
    assert "".join(e.delta for e in content_events) == "Hello! I am Vela, your AI assistant."

    done_event = events[-1]
    assert isinstance(done_event, DoneSSEEvent)
    assert done_event.agent == "personal assistant"
    assert done_event.thread_title

    # Verify DB persistence
    with get_db_session() as session:
        exp = (
            session.query(Experience)
            .filter_by(conversation_id=thread_id)
            .order_by(Experience.created_at.desc())
            .first()
        )
        assert exp is not None
        assert exp.user_query == "Hi Vela"
        assert exp.agent_response == "Hello! I am Vela, your AI assistant."

        conv = session.query(Conversation).filter_by(id=thread_id).first()
        assert conv is not None
        assert conv.agent == "personal assistant"


def test_e2e_single_turn_android_client_sync_message(deterministic_app):
    """When conversation source is 'android_client', a completed turn generates

    both an Experience row and a SyncMessage for device synchronization.
    """
    thread_id = deterministic_app.seeded_data.thread_id
    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=thread_id).first()
        assert conv is not None
        conv.source = "android_client"
        session.commit()

    expected_reply = "Android client sync verification message."
    deterministic_app.provider.add_turn([expected_reply])

    payload = {"thread_id": thread_id, "message": "Sync to my phone"}
    with deterministic_app.stream("POST", "/chat/message", json=payload) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    assert any(isinstance(e, DoneSSEEvent) for e in events)

    # Verify Experience and SyncMessage rows in DB
    with get_db_session() as session:
        exp = (
            session.query(Experience)
            .filter_by(conversation_id=thread_id)
            .order_by(Experience.created_at.desc())
            .first()
        )
        assert exp is not None
        assert exp.agent_response == expected_reply

        sync_msg = (
            session.query(SyncMessage)
            .filter_by(
                conversation_id=thread_id,
                role="assistant",
                content=expected_reply,
            )
            .first()
        )
        assert sync_msg is not None
        assert sync_msg.provider == "cloud"


# ===========================================================================
# 2. Multi-Turn Streaming & History Retention
# ===========================================================================


def test_e2e_multi_turn_streaming_retains_context(deterministic_app):
    """Sequential turns retain conversation history across requests:

    Turn 1 is stored in DB; Turn 2 system prompt receives Turn 1 history;
    GET /chat/threads/{thread_id} exposes the complete conversation.
    """
    thread_id = str(uuid.uuid4())

    # --- Turn 1 ---
    deterministic_app.provider.add_turn(["Noted! Python is a great language."])
    payload_1 = {
        "thread_id": thread_id,
        "message": "My favorite programming language is Python.",
    }
    with deterministic_app.stream("POST", "/chat/message", json=payload_1) as resp1:
        assert resp1.status_code == 200
        events_1 = _collect_sse_events(resp1)
    assert isinstance(events_1[-1], DoneSSEEvent)

    # --- Turn 2 ---
    deterministic_app.provider.add_turn(["You mentioned Python."])
    payload_2 = {
        "thread_id": thread_id,
        "message": "What language did I just mention?",
    }
    with deterministic_app.stream("POST", "/chat/message", json=payload_2) as resp2:
        assert resp2.status_code == 200
        events_2 = _collect_sse_events(resp2)
    assert isinstance(events_2[-1], DoneSSEEvent)

    # Verify Turn 2 LLM invocation included Turn 1 in its system prompt
    last_call = deterministic_app.provider.last_call
    assert last_call is not None
    sys_msg = next(
        (m for m in last_call["messages"] if isinstance(m, SystemMessage)),
        None,
    )
    assert sys_msg is not None
    assert "My favorite programming language is Python." in sys_msg.content
    assert "Noted! Python is a great language." in sys_msg.content

    # Verify HTTP thread history route returns all 4 messages
    hist_resp = deterministic_app.get(f"/chat/threads/{thread_id}")
    assert hist_resp.status_code == 200
    messages = hist_resp.json()
    assert len(messages) == 4
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "My favorite programming language is Python."
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "Noted! Python is a great language."
    assert messages[2]["role"] == "user"
    assert messages[2]["content"] == "What language did I just mention?"
    assert messages[3]["role"] == "assistant"
    assert messages[3]["content"] == "You mentioned Python."

    # Verify DB has 2 Experience rows
    with get_db_session() as session:
        exps = session.query(Experience).filter_by(conversation_id=thread_id).all()
        assert len(exps) == 2


# ===========================================================================
# 3. Tool-Calling Turns
# ===========================================================================


def test_e2e_tool_calling_save_briefing_watch_item(deterministic_app):
    """Scripted tool call 'save_briefing_watch_item' emits tool call XML tags in SSE stream,

    executes the tool against the real DB layer, and persists the watch item
    in the system settings table.
    """
    thread_id = deterministic_app.seeded_data.thread_id
    item_text = "Track the CI migration to GitHub Actions"

    # Turn 1: tool call, Turn 2: final assistant message
    deterministic_app.provider.add_turn(
        ScriptedToolCall(
            name="save_briefing_watch_item",
            args={"text": item_text, "date_hint": "next week"},
        )
    )
    deterministic_app.provider.add_turn(["Added that topic to your daily briefing watch list."])

    payload = {
        "thread_id": thread_id,
        "message": "Watch the CI migration for me",
    }
    with deterministic_app.stream("POST", "/chat/message", json=payload) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    # Validate tool call tags and answer in content stream
    content_deltas = [e.delta for e in events if isinstance(e, ContentSSEEvent)]
    full_content = "".join(content_deltas)
    assert "<call:save_briefing_watch_item" in full_content
    assert "</call:save_briefing_watch_item>" in full_content
    assert "Added that topic to your daily briefing watch list." in full_content

    # Terminal event must be DoneSSEEvent
    assert isinstance(events[-1], DoneSSEEvent)

    # Verify the watch item was persisted in system settings
    with get_db_session() as session:
        client = DBClient(session)
        items = client.get_watch_items()
    assert any(item_text in item.get("text", "") for item in items)


def test_e2e_tool_calling_send_status_message(deterministic_app):
    """Scripted tool call 'send_status_message' emits intermediate status updates

    and conforms to the SSE spec through stream completion.
    """
    thread_id = deterministic_app.seeded_data.thread_id

    deterministic_app.provider.add_turn(
        ScriptedToolCall(
            name="send_status_message",
            args={"chat_id": 998877, "message": "Searching diagnostic logs..."},
        )
    )
    deterministic_app.provider.add_turn(["Diagnostics complete: no issues found."])

    payload = {"thread_id": thread_id, "message": "Run system diagnostics"}
    with deterministic_app.stream("POST", "/chat/message", json=payload) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    content_deltas = [e.delta for e in events if isinstance(e, ContentSSEEvent)]
    full_content = "".join(content_deltas)
    assert "<call:send_status_message" in full_content
    assert "</call:send_status_message>" in full_content
    assert "Diagnostics complete" in full_content
    assert isinstance(events[-1], DoneSSEEvent)


# ===========================================================================
# 4. Thread Lifecycle Management (List, Rename, Branch, Truncate, Delete)
# ===========================================================================


def test_e2e_thread_lifecycle_management(deterministic_app):
    """Full HTTP thread lifecycle: list threads, rename thread via POST and PATCH,

    branch thread, and truncate thread history.
    """
    # 1. List threads: seeded threads are present
    list_resp = deterministic_app.get("/chat/threads")
    assert list_resp.status_code == 200
    threads = list_resp.json()
    assert len(threads) >= 2
    seeded_ids = {t["id"] for t in threads}
    assert deterministic_app.seeded_data.thread_id in seeded_ids

    # 2. Create a new thread by streaming a message
    thread_id = str(uuid.uuid4())
    deterministic_app.provider.add_turn(["First reply on lifecycle thread."])
    with deterministic_app.stream(
        "POST",
        "/chat/message",
        json={"thread_id": thread_id, "message": "Turn 1 question"},
    ) as resp:
        assert resp.status_code == 200
        _ = _collect_sse_events(resp)

    # Verify newly created thread appears in /chat/threads
    list_resp = deterministic_app.get("/chat/threads")
    threads = list_resp.json()
    created_entry = next((t for t in threads if t["id"] == thread_id), None)
    assert created_entry is not None

    # 3. Rename thread via POST /chat/threads/
    rename_resp = deterministic_app.post(
        "/chat/threads/",
        json={"thread_id": thread_id, "title": "Renamed Lifecycle Thread"},
    )
    assert rename_resp.status_code == 200
    assert rename_resp.json()["status"] == "success"
    assert (
        deterministic_app.get(f"/chat/threads/{thread_id}").status_code == 200
    )

    # Also test PATCH /chat/threads/{thread_id} updates title & pinning
    patch_resp = deterministic_app.patch(
        f"/chat/threads/{thread_id}",
        json={"title": "Patched Thread Title", "is_pinned": True},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["title"] == "Patched Thread Title"
    assert patch_resp.json()["is_pinned"] is True

    # 4. Add Turn 2 to build history for branching and truncation
    deterministic_app.provider.add_turn(["Second reply on lifecycle thread."])
    with deterministic_app.stream(
        "POST",
        "/chat/message",
        json={"thread_id": thread_id, "message": "Turn 2 question"},
    ) as resp:
        assert resp.status_code == 200
        _ = _collect_sse_events(resp)

    hist_resp = deterministic_app.get(f"/chat/threads/{thread_id}")
    assert hist_resp.status_code == 200
    history = hist_resp.json()
    assert len(history) == 4
    first_user_msg_id = history[0]["id"]
    second_user_msg_id = history[2]["id"]

    # 5. Branch thread at message 1 via POST /chat/threads/branch
    branched_id = str(uuid.uuid4())
    branch_payload = {
        "parent_thread_id": thread_id,
        "new_thread_id": branched_id,
        "upto_message_id": first_user_msg_id,
        "title": "Branched Fork Thread",
    }
    branch_resp = deterministic_app.post(
        "/chat/threads/branch",
        json=branch_payload,
    )
    assert branch_resp.status_code == 200
    assert branch_resp.json()["status"] == "success"

    # Branched thread has only Turn 1 (2 messages)
    branched_hist = deterministic_app.get(f"/chat/threads/{branched_id}").json()
    assert len(branched_hist) == 2
    assert branched_hist[0]["content"] == "Turn 1 question"

    # 6. Truncate thread at Turn 2 message
    trunc_resp = deterministic_app.post(
        f"/chat/threads/{thread_id}/truncate",
        json={"upto_message_id": second_user_msg_id},
    )
    assert trunc_resp.status_code == 200
    assert trunc_resp.json()["status"] == "success"

    # History after truncation has only Turn 1 remaining
    trunc_hist = deterministic_app.get(f"/chat/threads/{thread_id}").json()
    assert len(trunc_hist) == 2
    assert trunc_hist[0]["content"] == "Turn 1 question"


def test_e2e_thread_deletion_lifecycle(deterministic_app):
    """DELETE /chat/threads/{thread_id} drops the thread and cascades deletion

    to its messages, returning 404 for subsequent queries.
    """
    thread_id = str(uuid.uuid4())
    deterministic_app.provider.add_turn(["Message before deletion."])

    with deterministic_app.stream(
        "POST",
        "/chat/message",
        json={"thread_id": thread_id, "message": "Pre-delete query"},
    ) as resp:
        assert resp.status_code == 200
        _ = _collect_sse_events(resp)

    # Verify thread exists
    assert deterministic_app.get(f"/chat/threads/{thread_id}").status_code == 200

    # Delete thread
    del_resp = deterministic_app.delete(f"/chat/threads/{thread_id}")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"status": "success"}

    # Subsequent GET returns 404
    assert deterministic_app.get(f"/chat/threads/{thread_id}").status_code == 404

    # Repeated DELETE returns 404
    assert deterministic_app.delete(f"/chat/threads/{thread_id}").status_code == 404


# ===========================================================================
# 5. Authentication Gate Enforcement
# ===========================================================================


def test_e2e_auth_gate_enforcement(deterministic_app):
    """Protected endpoints require valid Bearer authentication:

    - Missing credentials -> 403 Forbidden
    - Invalid key mismatch -> 401 Unauthorized
    - Valid configured key -> 200 OK
    """
    from fastapi.testclient import TestClient

    from agent.main import app

    raw_client = TestClient(app)

    protected_paths = [
        ("GET", "/health"),
        ("GET", "/chat/threads"),
        ("GET", f"/chat/threads/{deterministic_app.seeded_data.thread_id}"),
        ("POST", "/chat/message"),
    ]

    for method, path in protected_paths:
        # Case 1: Missing credentials
        resp_missing = raw_client.request(method, path, json={})
        assert (
            resp_missing.status_code == 403
        ), f"Expected 403 on {method} {path} without credentials, got {resp_missing.status_code}"

        # Case 2: Invalid API key
        bad_headers = {"Authorization": "Bearer totally-invalid-api-key"}
        resp_invalid = raw_client.request(method, path, json={}, headers=bad_headers)
        assert (
            resp_invalid.status_code == 401
        ), f"Expected 401 on {method} {path} with bad credentials, got {resp_invalid.status_code}"

    # Case 3: Valid API key succeeds
    good_headers = {"Authorization": "Bearer test-api-key"}
    health_resp = raw_client.get("/health", headers=good_headers)
    assert health_resp.status_code == 200
    assert health_resp.json()["status"] == "ok"


# ===========================================================================
# 6. Persona & Dynamic System Prompt Fragments
# ===========================================================================


def test_e2e_persona_and_system_prompt_fragment_inclusion(deterministic_app):
    """When a chat request specifies a registered agent persona and the DB has

    dynamic prompt rules, both are injected into the agent's system prompt.
    """
    rule_content = "STRICT_CRITICAL_RULE: Always reference verifiable telemetry."
    with get_db_session() as session:
        session.query(SystemPromptFragment).filter_by(key="dynamic_rules").delete()
        session.add(SystemPromptFragment(key="dynamic_rules", content=rule_content))
        session.commit()

    deterministic_app.provider.add_turn(["Hello student! Let us explore physics together."])

    thread_id = str(uuid.uuid4())
    payload = {
        "thread_id": thread_id,
        "message": "Why is the sky blue?",
        "agent": "teacher",
    }

    with deterministic_app.stream("POST", "/chat/message", json=payload) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    done_event = events[-1]
    assert isinstance(done_event, DoneSSEEvent)
    assert done_event.agent == "teacher"

    # Inspect the system prompt received by the FakeProvider LLM
    chatbot_call = next(
        (
            c
            for c in deterministic_app.provider.calls
            if any(isinstance(m, SystemMessage) for m in c["messages"])
        ),
        None,
    )
    assert chatbot_call is not None, "No LLM call found containing a SystemMessage"
    sys_msg = next(m for m in chatbot_call["messages"] if isinstance(m, SystemMessage))

    # Verify dynamic rules section
    assert "# Dynamic Rules" in sys_msg.content
    assert rule_content in sys_msg.content

    # Verify teacher persona prompt instructions
    assert "friendly, encouraging, and knowledgeable Teacher" in sys_msg.content


# ===========================================================================
# 7. Error Handling on Script Exhaustion
# ===========================================================================


def test_e2e_error_handling_script_exhaustion_emits_sse_error(deterministic_app):
    """When FakeProvider script is exhausted, the streaming generator yields

    a spec-compliant ErrorSSEEvent and terminates cleanly without hanging.
    """
    deterministic_app.provider.clear()  # No scripted turns

    payload = {
        "thread_id": str(uuid.uuid4()),
        "message": "This request has no scripted turn available",
    }
    with deterministic_app.stream("POST", "/chat/message", json=payload) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    # Must contain an ErrorSSEEvent conforming to spec
    error_events = [e for e in events if isinstance(e, ErrorSSEEvent)]
    assert len(error_events) >= 1
    err = error_events[0]
    assert err.type == "error"
    assert "script exhausted" in err.message.lower()

    # Stream terminates without hanging; semaphore is cleanly released
    list_resp = deterministic_app.get("/chat/threads")
    assert list_resp.status_code == 200


# ===========================================================================
# 8. Malformed & Unprocessable Requests
# ===========================================================================


def test_e2e_malformed_and_unprocessable_requests(deterministic_app):
    """Validation gates strictly reject missing or malformed request payloads:

    - 422 Unprocessable Entity for missing required fields
    - 400 Bad Request for unsupported agent identifiers
    - 404 Not Found for non-existent thread lookups
    """
    # Missing both thread_id and message
    assert deterministic_app.post("/chat/message", json={}).status_code == 422

    # Missing message
    assert (
        deterministic_app.post("/chat/message", json={"thread_id": "tid-1"}).status_code
        == 422
    )

    # Missing thread_id
    assert (
        deterministic_app.post("/chat/message", json={"message": "hello"}).status_code
        == 422
    )

    # Unsupported agent identifier
    unsupported_agent_resp = deterministic_app.post(
        "/chat/message",
        json={
            "thread_id": "tid-1",
            "message": "hello",
            "agent": "unregistered_super_bot",
        },
    )
    assert unsupported_agent_resp.status_code == 400
    assert "Unsupported agent" in unsupported_agent_resp.json()["detail"]

    # Truncate with empty payload
    assert (
        deterministic_app.post(
            f"/chat/threads/{deterministic_app.seeded_data.thread_id}/truncate",
            json={},
        ).status_code
        == 422
    )

    # Branch with empty payload
    assert deterministic_app.post("/chat/threads/branch", json={}).status_code == 422

    # Non-existent thread lookup returns 404
    non_existent = str(uuid.uuid4())
    assert deterministic_app.get(f"/chat/threads/{non_existent}").status_code == 404


# ===========================================================================
# 9. Eval-Thread Bypass Verification
# ===========================================================================


def test_e2e_eval_thread_bypasses_experience_db(deterministic_app):
    """Threads prefixed with 'eval-' do not write Experience rows to the DB,

    retaining state purely in the ephemeral eval store.
    """
    eval_thread_id = f"eval-e2e-turn-{uuid.uuid4()}"
    deterministic_app.provider.add_turn(["Ephemeral eval response."])

    payload = {"thread_id": eval_thread_id, "message": "Benchmark eval turn"}
    with deterministic_app.stream("POST", "/chat/message", json=payload) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    done_event = events[-1]
    assert isinstance(done_event, DoneSSEEvent)

    # Verify database has ZERO experiences for this eval thread
    with get_db_session() as session:
        exps = session.query(Experience).filter_by(conversation_id=eval_thread_id).all()
        assert len(exps) == 0

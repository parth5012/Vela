"""Conformance test suite for SSE event schemas and Agent Tool Registry.

Enforces:
1. SSE validator correctly parses valid lines/events and strictly rejects
   unknown event types, missing required fields, and malformed inputs.
2. Tool registry conformance: every tool wired into backend/agent/graph.py
   is registered in TOOL_SPECS, and every tool in TOOL_SPECS is wired into
   graph.py (no dead tools, no unregistered tools). Every tool spec has
   non-empty metadata and a valid BaseModel schema.
3. Stream conformance: live SSE streams from /chat/message executed via
   deterministic_app / FakeProvider comply with SSE_EVENTS across:
   - Plain text streaming turn
   - Tool-invoking turn (scripted tool call)
   - Error/termination turn
"""

from __future__ import annotations

import pytest
from pydantic import BaseModel, ValidationError

from agent.graph import tools_list as graph_tools
from agent.registry import AGENT_REGISTRY
from agent.spec import (
    SSE_EVENTS,
    TOOL_SPECS,
    AuthRequiredSSEEvent,
    ContentSSEEvent,
    DoneSSEEvent,
    ErrorSSEEvent,
    ThreadStoppedSSEEvent,
    ToolCallSSEEvent,
    get_registered_tools,
    get_tool_spec,
    validate_sse_event,
    validate_sse_line,
)
from agent.testing.provider import ScriptedToolCall


# ===========================================================================
# 1. SSE Validator Unit Tests
# ===========================================================================


def test_validate_sse_line_content_events():
    """Verify parsing and validation of 'content' SSE lines."""
    line = 'data: {"type": "content", "delta": "Hello world"}\n\n'
    event = validate_sse_line(line)

    assert isinstance(event, ContentSSEEvent)
    assert event.type == "content"
    assert event.delta == "Hello world"
    assert event.role is None
    assert event.message_id is None

    # Test with optional fields
    line_with_opt = (
        'data: {"type": "content", "delta": "chunk", "role": "assistant", "message_id": "msg-1"}'
    )
    event_opt = validate_sse_line(line_with_opt)
    assert isinstance(event_opt, ContentSSEEvent)
    assert event_opt.role == "assistant"
    assert event_opt.message_id == "msg-1"


def test_validate_sse_line_done_events():
    """Verify parsing and validation of 'done' SSE lines."""
    line = (
        'data: {"type": "done", "thread_title": "My New Conversation", '
        '"agent": "personal assistant"}\n\n'
    )
    event = validate_sse_line(line)

    assert isinstance(event, DoneSSEEvent)
    assert event.type == "done"
    assert event.thread_title == "My New Conversation"
    assert event.agent == "personal assistant"


def test_validate_sse_line_error_events():
    """Verify parsing and validation of 'error' SSE lines."""
    line = 'data: {"type": "error", "message": "Database connection timeout"}\n\n'
    event = validate_sse_line(line)

    assert isinstance(event, ErrorSSEEvent)
    assert event.type == "error"
    assert event.message == "Database connection timeout"


def test_validate_sse_line_thread_stopped_events():
    """Verify parsing and validation of 'thread_stopped' SSE lines."""
    line = 'data: {"type": "thread_stopped", "thread_id": "conv-uuid-1234"}\n\n'
    event = validate_sse_line(line)

    assert isinstance(event, ThreadStoppedSSEEvent)
    assert event.type == "thread_stopped"
    assert event.thread_id == "conv-uuid-1234"


def test_validate_sse_line_auth_required_events():
    """Verify parsing and validation of 'auth_required' SSE lines."""
    line = 'data: {"type": "auth_required", "provider": "google"}\n\n'
    event = validate_sse_line(line)

    assert isinstance(event, AuthRequiredSSEEvent)
    assert event.type == "auth_required"
    assert event.provider == "google"


def test_validate_sse_line_tool_call_events():
    """Verify parsing and validation of 'tool_call' SSE lines."""
    line = (
        'data: {"type": "tool_call", "tool_name": "web_search", '
        '"tool_input": {"query": "Vela AI"}}\n\n'
    )
    event = validate_sse_line(line)

    assert isinstance(event, ToolCallSSEEvent)
    assert event.type == "tool_call"
    assert event.tool_name == "web_search"
    assert event.tool_input == {"query": "Vela AI"}


def test_validate_sse_event_all_registered_types():
    """Verify validate_sse_event against all types registered in SSE_EVENTS."""
    sample_payloads = {
        "content": {"type": "content", "delta": "text"},
        "done": {"type": "done", "thread_title": "Title"},
        "error": {"type": "error", "message": "Failed"},
        "thread_stopped": {"type": "thread_stopped", "thread_id": "t-1"},
        "auth_required": {"type": "auth_required", "provider": "google"},
        "tool_call": {"type": "tool_call", "tool_name": "calc"},
    }

    assert set(sample_payloads.keys()) == set(SSE_EVENTS.keys())

    for event_type, payload in sample_payloads.items():
        ev = validate_sse_event(payload)
        model_cls = SSE_EVENTS[event_type]
        assert isinstance(ev, model_cls)
        assert ev.type == event_type


@pytest.mark.parametrize(
    "invalid_line, expected_error_substr",
    [
        ("", "Empty SSE line"),
        ("   \n", "Empty SSE line"),
        (": keep-alive\n\n", "SSE comment line is not an event"),
        ("plain string without prefix", "Malformed SSE line"),
        ("data: ", "Empty data payload"),
        ("data: not-valid-json", "Malformed JSON"),
        ("data: [1, 2, 3]", "Expected dict for event data"),
        ('data: {"unknown_field": "val"}', "Missing required 'type' field"),
        ('data: {"type": "nonexistent_type"}', "Unknown SSE event type"),
    ],
)
def test_validate_sse_line_rejects_malformed_and_unknown_lines(
    invalid_line, expected_error_substr
):
    """Verify rejection of empty, comment, non-SSE, non-JSON, or unregistered event lines."""
    with pytest.raises(ValueError) as excinfo:
        validate_sse_line(invalid_line)
    assert expected_error_substr in str(excinfo.value)


@pytest.mark.parametrize(
    "missing_field_line",
    [
        'data: {"type": "content"}',  # missing delta
        'data: {"type": "done"}',  # missing thread_title
        'data: {"type": "done", "thread_title": ""}',  # empty thread_title
        'data: {"type": "error"}',  # missing message
        'data: {"type": "thread_stopped"}',  # missing thread_id
        'data: {"type": "auth_required"}',  # missing provider
    ],
)
def test_validate_sse_line_rejects_missing_required_fields(missing_field_line):
    """Verify rejection when a registered event is missing mandatory fields."""
    with pytest.raises(ValidationError):
        validate_sse_line(missing_field_line)


def test_validate_sse_line_rejects_forbidden_extra_fields():
    """Verify that unexpected extra fields are rejected under strict schema configuration."""
    line = 'data: {"type": "content", "delta": "text", "extra_bad_field": 123}'
    with pytest.raises(ValidationError):
        validate_sse_line(line)


# ===========================================================================
# 2. Tool Registry Conformance Tests
# ===========================================================================


def test_tool_registry_conformance_with_graph_tools():
    """Assert every tool wired into backend/agent/graph.py is registered in TOOL_SPECS,
    and every tool in TOOL_SPECS is wired into graph.py (no dead tools, no unregistered tools).
    """
    graph_tool_names = {t.name for t in graph_tools}
    registered_tool_names = set(TOOL_SPECS.keys())

    unregistered_tools = graph_tool_names - registered_tool_names
    dead_tools = registered_tool_names - graph_tool_names

    assert (
        not unregistered_tools
    ), f"Tools in agent graph missing from TOOL_SPECS: {unregistered_tools}"
    assert not dead_tools, f"Tools in TOOL_SPECS not wired into agent graph: {dead_tools}"
    assert graph_tool_names == registered_tool_names


def test_get_registered_tools_helper():
    """Verify get_registered_tools returns all tools registered in TOOL_SPECS."""
    tools = get_registered_tools()
    assert len(tools) == len(TOOL_SPECS)
    tool_names = {t.name for t in tools}
    assert tool_names == set(TOOL_SPECS.keys())


def test_tool_specs_metadata_and_schema_quality():
    """Assert every registered tool spec has valid name, description, schema, and source_tool."""
    for name, spec in TOOL_SPECS.items():
        assert spec.name == name
        assert spec.description and isinstance(spec.description, str)
        assert len(spec.description.strip()) > 5, f"Tool {name} description too short"

        # Schema conformance
        assert spec.args_schema is not None, f"Tool {name} has no args_schema"
        assert issubclass(
            spec.args_schema, BaseModel
        ), f"Tool {name} schema not a Pydantic BaseModel"
        assert spec.input_schema is spec.args_schema

        # Source tool conformance
        assert spec.source_tool is not None
        assert spec.source_tool.name == name
        assert spec.source_tool.description == spec.description

        # get_tool_spec lookup helper
        lookup = get_tool_spec(name)
        assert lookup is spec


def test_agent_registry_tools_are_all_in_tool_specs():
    """Assert every tool referenced across all agents in AGENT_REGISTRY is in TOOL_SPECS."""
    registered_names = set(TOOL_SPECS.keys())
    for agent in AGENT_REGISTRY.list_agents():
        for tool_name in agent.tool_names:
            assert tool_name in registered_names, (
                f"Agent '{agent.identifier}' references unregistered tool '{tool_name}'"
            )


# ===========================================================================
# 3. Stream Conformance Tests (Live /chat/message via FakeProvider)
# ===========================================================================


def test_stream_plain_text_reply_conforms_to_sse_spec(deterministic_app):
    """Verify that a plain-text chat streaming turn strictly adheres to SSE_EVENTS."""
    deterministic_app.provider.add_turn(["Hello ", "from ", "Vela!"])
    payload = {
        "thread_id": deterministic_app.seeded_data.thread_id,
        "message": "Say hello",
    }

    validated_events = []
    with deterministic_app.stream("POST", "/chat/message", json=payload) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        for line in response.iter_lines():
            # Skip empty lines and SSE comment pings (: keep-alive)
            if not line or line.startswith(":"):
                continue
            ev = validate_sse_line(line)
            validated_events.append(ev)

    assert validated_events, "No SSE events received from stream"

    # All non-terminal events must be ContentSSEEvent
    content_events = [e for e in validated_events if isinstance(e, ContentSSEEvent)]
    assert content_events, "Expected at least one content event"

    deltas = [e.delta for e in content_events]
    assert "".join(deltas) == "Hello from Vela!"

    # The terminal event must be DoneSSEEvent with non-empty thread_title
    terminal_event = validated_events[-1]
    assert isinstance(terminal_event, DoneSSEEvent)
    assert terminal_event.thread_title
    assert terminal_event.agent == "personal assistant"


def test_stream_tool_invocation_conforms_to_sse_spec(deterministic_app):
    """Verify that a tool-invoking turn (scripted tool call + follow-up answer) conforms to SSE_EVENTS."""
    # Turn 1: Scripted tool call to run_python_code
    # Turn 2: Follow-up final answer
    deterministic_app.provider.add_turn(
        ScriptedToolCall(name="run_python_code", args={"code": "print(2 + 2)"})
    )
    deterministic_app.provider.add_turn(["The calculation result is 4."])

    payload = {
        "thread_id": deterministic_app.seeded_data.thread_id,
        "message": "Compute 2 + 2 with Python",
    }

    validated_events = []
    with deterministic_app.stream("POST", "/chat/message", json=payload) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        for line in response.iter_lines():
            if not line or line.startswith(":"):
                continue
            ev = validate_sse_line(line)
            validated_events.append(ev)

    assert validated_events, "No SSE events received from stream"

    # Verify tool start tag, tool end tag, and final answer deltas
    content_deltas = [e.delta for e in validated_events if isinstance(e, ContentSSEEvent)]
    full_content = "".join(content_deltas)

    assert "<call:run_python_code input=" in full_content
    assert "</call:run_python_code>" in full_content
    assert "The calculation result is 4." in full_content

    # Every event must match one of the registered models
    for ev in validated_events:
        assert isinstance(ev, tuple(SSE_EVENTS.values()))

    # Terminal event must be DoneSSEEvent
    assert isinstance(validated_events[-1], DoneSSEEvent)
    assert validated_events[-1].thread_title


def test_stream_error_path_conforms_to_sse_spec(deterministic_app):
    """Verify that an error occurring during stream execution emits an ErrorSSEEvent conforming to spec."""
    # Empty script causes FakeProvider to raise RuntimeError when called
    deterministic_app.provider.script = []

    payload = {
        "thread_id": deterministic_app.seeded_data.thread_id,
        "message": "Trigger stream failure",
    }

    validated_events = []
    with deterministic_app.stream("POST", "/chat/message", json=payload) as response:
        assert response.status_code == 200

        for line in response.iter_lines():
            if not line or line.startswith(":"):
                continue
            ev = validate_sse_line(line)
            validated_events.append(ev)

    assert validated_events, "No SSE events received from error stream"

    error_events = [e for e in validated_events if isinstance(e, ErrorSSEEvent)]
    assert len(error_events) == 1, f"Expected exactly 1 ErrorSSEEvent, got {len(error_events)}"
    err = error_events[0]
    assert err.type == "error"
    assert "script exhausted" in err.message.lower()

    # Terminal event should still be a valid DoneSSEEvent
    assert isinstance(validated_events[-1], DoneSSEEvent)

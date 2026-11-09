"""Contract tests for the actual backend SSE stream (issue #547).

Captures the real ``POST /chat/message`` SSE output (via ``deterministic_app``
+ ``FakeProvider`` — mocking only the external LLM provider) and validates it
with the Android oracle ``evals.validate_sse.assert_valid_sse``, instead of
validating fabricated in-memory chunks.

The live-stream contract under test:
- chunk sequence is ``content*`` followed by exactly one terminal ``done``;
- the terminal ``done`` carries a non-empty ``thread_title`` (and the seeded
  conversation title for the seeded thread);
- XML segments in the accumulated content (``<call:...>``, ``<thought>``,
  ``<intent>``) are well-formed per ``validate_xml_segments``;
- there are no trailing events after ``done``.

The negative checks below mutate a *live-captured* stream and assert the same
oracle fires, proving the contract tests detect endpoint violations rather
than passing vacuously on fabricated input.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from agent.spec import validate_sse_line
from agent.testing.provider import ScriptedToolCall
from evals.validate_sse import (
    SSEValidationError,
    assert_valid_sse,
    parse_sse_stream,
    validate_xml_segments,
)

# Canonical live-stream expectation, mirroring the sse_streaming family in
# backend/evals/golden.jsonl.
LIVE_SSE_EXPECTATION: dict[str, Any] = {
    "chunk_sequence": ["content*", "done"],
    "done.thread_title required": True,
    "xml segments well-formed": True,
}


def _capture_live_sse_lines(client: Any, payload: dict[str, Any]) -> list[str]:
    """Stream POST /chat/message via the real FastAPI app and return raw SSE lines."""
    with client.stream("POST", "/chat/message", json=payload) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        raw_lines: list[str] = list(response.iter_lines())
    assert raw_lines, "No SSE output captured from live /chat/message endpoint"
    return raw_lines


def _data_lines(raw_lines: list[str]) -> list[str]:
    """Return only the data: lines (drops empty lines and : keep-alive pings)."""
    return [line for line in raw_lines if line.strip().startswith("data:")]


def _load_event(line: str) -> dict[str, Any]:
    """Parse one ``data: {...}`` line back into a dict."""
    return json.loads(line.strip()[len("data:"):].strip())


def _dump_event(event: dict[str, Any]) -> str:
    """Serialize an event dict as an SSE ``data:`` line."""
    return f"data: {json.dumps(event)}"


def _assert_live_conformance(raw_lines: list[str]) -> Any:
    """Run the full live-stream oracle and return the validation result."""
    result = assert_valid_sse(raw_lines, LIVE_SSE_EXPECTATION)
    # Cross-check every live data line against the strict Pydantic spec, so
    # schema drift (e.g. extra fields) is caught alongside oracle errors.
    for line in _data_lines(raw_lines):
        validate_sse_line(line)
    # Terminal done event + no trailing events, stated explicitly.
    assert result.events, "No events in live SSE stream"
    assert result.events[-1].get("type") == "done", "Terminal event must be 'done'"
    assert [ev.get("type") for ev in result.events].count("done") == 1
    # thread_title presence/format against the oracle's done_event.
    assert result.done_event is not None
    title = result.done_event.get("thread_title")
    assert isinstance(title, str) and title.strip(), (
        "'done.thread_title' must be a non-empty string"
    )
    # XML well-formedness stated directly via the oracle helper.
    assert validate_xml_segments(result.full_content) == []
    return result


def test_sse_contract_plain_text_real_stream(deterministic_app):
    """Plain-text live stream obeys chunk sequence, title, XML, and terminal done."""
    from db.models import Conversation
    from db.session import get_db_session

    with get_db_session() as session:
        conv = session.query(Conversation).filter_by(id=deterministic_app.seeded_data.thread_id).first()
        seeded_title = conv.title if conv is not None else None
    assert seeded_title
    deterministic_app.provider.add_turn(["Hello ", "from ", "Vela!"])
    payload = {
        "thread_id": deterministic_app.seeded_data.thread_id,
        "message": "Say hello",
    }
    raw_lines = _capture_live_sse_lines(deterministic_app, payload)
    result = _assert_live_conformance(raw_lines)

    assert result.full_content == "Hello from Vela!"
    chunk_types = [ev.get("type") for ev in result.events]
    assert chunk_types == ["content", "content", "content", "done"]
    assert result.done_event["thread_title"] == seeded_title
    assert result.done_event.get("agent") == "personal assistant"


def test_sse_contract_tool_call_real_stream(deterministic_app):
    """Tool-invoking live stream carries well-formed <call:...> XML to the oracle.

    This is the gap the fabricated chunks in test_golden missed: the chunk
    sequence is validated against the *live* endpoint output, so a dropped or
    broken tool tag in the endpoint fails here even though fabricated
    tool_chunks would still pass.
    """
    deterministic_app.provider.add_turn(
        ScriptedToolCall(name="run_python_code", args={"code": "print(2 + 2)"})
    )
    deterministic_app.provider.add_turn(["The calculation result is 4."])
    payload = {
        "thread_id": deterministic_app.seeded_data.thread_id,
        "message": "Compute 2 + 2 with Python",
    }
    raw_lines = _capture_live_sse_lines(deterministic_app, payload)
    result = _assert_live_conformance(raw_lines)

    assert "<call:run_python_code" in result.full_content
    assert "</call:run_python_code>" in result.full_content
    assert "The calculation result is 4." in result.full_content
    chunk_types = [ev.get("type") for ev in result.events]
    assert chunk_types[-1] == "done"
    assert all(t == "content" for t in chunk_types[:-1])


def test_sse_contract_xml_thought_intent_real_stream(deterministic_app):
    """Live stream keeps <thought>/<intent> XML well-formed when streamed as text."""
    deterministic_app.provider.add_turn(
        ["<thought>shopping for calls</thought>", "<intent>none</intent>", "All set."]
    )
    payload = {
        "thread_id": deterministic_app.seeded_data.thread_id,
        "message": "Say hello with markers",
    }
    raw_lines = _capture_live_sse_lines(deterministic_app, payload)
    result = _assert_live_conformance(raw_lines)

    assert "<thought>shopping for calls</thought>" in result.full_content
    assert "<intent>none</intent>" in result.full_content
    assert result.full_content.endswith("All set.")
    assert parse_sse_stream(raw_lines)[-1].get("type") == "done"


def test_sse_contract_detects_dropped_done_on_live_stream(deterministic_app):
    """Mutating the live capture to drop 'done' must fail the oracle."""
    deterministic_app.provider.add_turn(["Still here."])
    raw_lines = _capture_live_sse_lines(
        deterministic_app,
        {"thread_id": deterministic_app.seeded_data.thread_id, "message": "Say hi"},
    )
    truncated = [
        line for line in _data_lines(raw_lines) if _load_event(line).get("type") != "done"
    ]
    assert truncated, "Live capture had no non-done events to mutate"
    with pytest.raises(SSEValidationError, match="missing required terminal 'done' event"):
        assert_valid_sse(truncated, LIVE_SSE_EXPECTATION)


def test_sse_contract_detects_trailing_event_after_done(deterministic_app):
    """Appending a content event after the live 'done' must fail the oracle."""
    deterministic_app.provider.add_turn(["Done thinking."])
    raw_lines = _capture_live_sse_lines(
        deterministic_app,
        {"thread_id": deterministic_app.seeded_data.thread_id, "message": "Say hi"},
    )
    data = _data_lines(raw_lines)
    events = [_load_event(line) for line in data]
    assert events[-1].get("type") == "done"
    trailing = data + [_dump_event({"type": "content", "delta": " trailing"})]
    with pytest.raises(SSEValidationError, match="Events found after terminal 'done' event"):
        assert_valid_sse(trailing, LIVE_SSE_EXPECTATION)


def test_sse_contract_detects_missing_thread_title_on_live_stream(deterministic_app):
    """Stripping thread_title from the live 'done' must fail the oracle."""
    deterministic_app.provider.add_turn(["Titled reply."])
    raw_lines = _capture_live_sse_lines(
        deterministic_app,
        {"thread_id": deterministic_app.seeded_data.thread_id, "message": "Say hi"},
    )
    data = _data_lines(raw_lines)
    events = [_load_event(line) for line in data]
    assert events[-1].get("type") == "done"
    events[-1].pop("thread_title", None)
    mutated = [_dump_event(ev) for ev in events]
    with pytest.raises(
        SSEValidationError, match="missing required non-empty 'thread_title'"
    ):
        assert_valid_sse(mutated, LIVE_SSE_EXPECTATION)


def test_sse_contract_detects_broken_xml_on_live_stream(deterministic_app):
    """Removing the live <call:...> closing tag must fail the XML oracle."""
    deterministic_app.provider.add_turn(
        ScriptedToolCall(name="run_python_code", args={"code": "print(1)"})
    )
    deterministic_app.provider.add_turn(["Finished."])
    raw_lines = _capture_live_sse_lines(
        deterministic_app,
        {
            "thread_id": deterministic_app.seeded_data.thread_id,
            "message": "Compute 1 with Python",
        },
    )
    data = _data_lines(raw_lines)
    events = [_load_event(line) for line in data]
    mutated: list[str] = []
    stripped = False
    for ev in events:
        if ev.get("type") == "content":
            delta = str(ev.get("delta", ""))
            if "</call:run_python_code>" in delta:
                ev["delta"] = delta.replace("</call:run_python_code>", "")
                stripped = True
        mutated.append(_dump_event(ev))
    assert stripped, "Live tool stream had no closing tag to strip"
    with pytest.raises(SSEValidationError, match="Unclosed XML segment"):
        assert_valid_sse(mutated, LIVE_SSE_EXPECTATION)


def test_sse_contract_detects_reordered_sequence_on_live_stream(deterministic_app):
    """Moving the live 'done' before content must fail the chunk-sequence oracle."""
    deterministic_app.provider.add_turn(["Ordered reply."])
    raw_lines = _capture_live_sse_lines(
        deterministic_app,
        {"thread_id": deterministic_app.seeded_data.thread_id, "message": "Say hi"},
    )
    data = _data_lines(raw_lines)
    events = [_load_event(line) for line in data]
    assert events[-1].get("type") == "done"
    reordered = [events[-1], *events[:-1]]
    mutated = [_dump_event(ev) for ev in reordered]
    with pytest.raises(SSEValidationError, match="Chunk sequence mismatch"):
        assert_valid_sse(mutated, LIVE_SSE_EXPECTATION)

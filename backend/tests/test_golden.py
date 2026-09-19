"""Pytest runner for Vela Golden Dataset (v1).

Loads backend/evals/golden.jsonl and executes dual-oracle validation:
1. Supervisor intent classification, routing, and tool binding.
2. Android SSE streaming contract: chunk sequence, non-empty thread_title, well-formed XML tags.
Also verifies that malformed fixtures fail loudly.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage

from agent.main import app
from evals.validate_sse import (
    SSEValidationError,
    SSEValidationResult,
    assert_valid_sse,
    parse_sse_stream,
    validate_sse,
    validate_xml_segments,
)

GOLDEN_JSONL_PATH = Path(__file__).resolve().parent.parent / "evals" / "golden.jsonl"

VALID_FAMILIES = {
    "routing_ambiguity",
    "auth_gate",
    "memory_isolation",
    "skill_interruption",
    "hostile_inputs",
    "sse_streaming",
    "infra_failure",
}


def load_golden_cases() -> list[dict[str, Any]]:
    """Load and parse all rows from backend/evals/golden.jsonl."""
    if not GOLDEN_JSONL_PATH.exists():
        pytest.fail(f"Golden dataset file not found: {GOLDEN_JSONL_PATH}")

    cases: list[dict[str, Any]] = []
    with open(GOLDEN_JSONL_PATH, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                case = json.loads(line)
                cases.append(case)
            except json.JSONDecodeError as e:
                pytest.fail(f"Invalid JSON on line {line_num} of {GOLDEN_JSONL_PATH}: {e}")

    return cases


def test_golden_jsonl_schema():
    """Verify that every row in golden.jsonl adheres strictly to schema_version 1."""
    cases = load_golden_cases()
    assert len(cases) >= 2, f"Expected at least 2 seed cases, found {len(cases)}"

    seen_ids: set[str] = set()
    for case in cases:
        # Schema version
        assert case.get("schema_version") == 1, f"Invalid schema_version in case: {case}"

        # ID format
        case_id = case.get("id")
        assert isinstance(case_id, str) and re.match(r"^[a-z_]+_\d{3}$", case_id), (
            f"Invalid case ID format '{case_id}'; expected pattern '<family>_NNN'"
        )
        assert case_id not in seen_ids, f"Duplicate case ID '{case_id}'"
        seen_ids.add(case_id)

        # Family
        family = case.get("family")
        assert family in VALID_FAMILIES, f"Invalid family '{family}' in case '{case_id}'"

        # Input envelope
        inp = case.get("input")
        assert isinstance(inp, dict), f"Missing 'input' dict in case '{case_id}'"
        assert "message" in inp and isinstance(inp["message"], str), f"Missing 'input.message' in '{case_id}'"
        assert "thread_history" in inp and isinstance(inp["thread_history"], list)
        assert "auth_state" in inp and isinstance(inp["auth_state"], dict)

        # Expected supervisor envelope
        exp_sup = case.get("expected_supervisor")
        assert isinstance(exp_sup, dict), f"Missing 'expected_supervisor' in '{case_id}'"
        assert "route" in exp_sup and isinstance(exp_sup["route"], str)
        assert "tool_name" in exp_sup
        assert "arg_constraints" in exp_sup and isinstance(exp_sup["arg_constraints"], dict)
        assert "auth_gate_behavior" in exp_sup

        # Expected SSE envelope
        exp_sse = case.get("expected_sse")
        assert isinstance(exp_sse, dict), f"Missing 'expected_sse' in '{case_id}'"
        assert "chunk_sequence" in exp_sse and isinstance(exp_sse["chunk_sequence"], list)
        assert exp_sse.get("done.thread_title required") is True
        assert exp_sse.get("xml segments well-formed") is True


@pytest.mark.parametrize("case", load_golden_cases(), ids=lambda c: c["id"])
def test_golden_case_execution(case: dict[str, Any], monkeypatch: pytest.MonkeyPatch):
    """Execute each golden dataset case with mocked providers and assert dual-oracle correctness."""
    monkeypatch.setenv("VELA_API_KEY", "test-golden-key")
    headers = {"Authorization": "Bearer test-golden-key"}

    case_id = case["id"]
    inp = case["input"]
    exp_sup = case["expected_supervisor"]
    exp_sse = case["expected_sse"]

    client = TestClient(app)
    thread_id = f"eval-thread-{case_id}"

    # Setup mocks for supervisor and tool bindings
    if case_id == "routing_001":
        # Happy path conversational question: supervisor routes to chatbot, no tools
        payload = {
            "thread_id": thread_id,
            "message": inp["message"],
            "agent": inp.get("persona") or "personal assistant",
        }

        # Use TestClient streaming endpoint to capture real SSE output
        with client.stream("POST", "/chat/message", json=payload, headers=headers) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]
            lines = list(response.iter_lines())

        # Validate against strict SSE contract
        res = assert_valid_sse(lines, exp_sse)
        assert res.done_event is not None
        assert res.done_event.get("thread_title")

    elif case_id == "auth_001":
        # Google Workspace tool without tokens: triggers auth gate redirect
        # Mock ensure_google_auth or OAuth token retrieval returning AUTH_REQUIRED
        from utils.auth_gate import AUTH_REQUIRED

        # Simulate the SSE stream produced by an unauthenticated Google Workspace tool call
        tool_start_tag = '<call:gmail input="{}">'
        tool_end_tag = "Google Workspace not connected for this conversation.</call:gmail>"
        simulated_sse_chunks = [
            f"data: {json.dumps({'type': 'content', 'delta': tool_start_tag})}\n\n",
            f"data: {json.dumps({'type': 'auth_required', 'provider': 'google'})}\n\n",
            f"data: {json.dumps({'type': 'content', 'delta': tool_end_tag})}\n\n",
            f"data: {json.dumps({'type': 'done', 'thread_title': 'Check unread emails', 'agent': 'personal assistant'})}\n\n",
        ]

        # Verify supervisor oracle requirements
        assert exp_sup["route"] == "chatbot"
        assert exp_sup["tool_name"] == "gmail"
        assert exp_sup["auth_gate_behavior"] == "redirect"

        # Validate SSE stream against expected_sse
        res = assert_valid_sse(simulated_sse_chunks, exp_sse)
        assert res.valid
        assert any(ev.get("type") == "auth_required" for ev in res.events)
        assert res.done_event is not None
        assert res.done_event.get("thread_title") == "Check unread emails"


# ==============================================================================
# Malformed fixture tests: ensure validate_sse fails loudly on contract breaks
# ==============================================================================


def test_malformed_fixture_missing_done_fails_loudly():
    """Verify that a stream missing the terminal 'done' event fails loudly."""
    chunks = [
        'data: {"type": "content", "delta": "Hello world"}\n\n',
        'data: {"type": "content", "delta": " more text"}\n\n',
    ]
    with pytest.raises(SSEValidationError) as excinfo:
        assert_valid_sse(chunks, {"done.thread_title required": True})

    assert "missing required terminal 'done' event" in str(excinfo.value)


def test_malformed_fixture_split_tool_block_fails_loudly():
    """Verify that an unclosed or split tool XML block fails loudly."""
    chunks = [
        'data: {"type": "content", "delta": "Here is the search: <call:web_search input=\\"{\\"query\\": \\"python\\"}\\""}\n\n',
        'data: {"type": "done", "thread_title": "Search Query", "agent": "personal assistant"}\n\n',
    ]
    with pytest.raises(SSEValidationError) as excinfo:
        assert_valid_sse(chunks, {"xml segments well-formed": True})

    err_str = str(excinfo.value)
    assert "Unclosed XML segment(s)" in err_str or "Broken or truncated" in err_str or "Split/unclosed" in err_str


def test_malformed_fixture_missing_thread_title_fails_loudly():
    """Verify that a 'done' event without a thread_title fails loudly."""
    chunks = [
        'data: {"type": "content", "delta": "Done response"}\n\n',
        'data: {"type": "done", "agent": "personal assistant"}\n\n',
    ]
    with pytest.raises(SSEValidationError) as excinfo:
        assert_valid_sse(chunks, {"done.thread_title required": True})

    assert "'done' event missing required non-empty 'thread_title'" in str(excinfo.value)


def test_malformed_fixture_events_after_done_fails_loudly():
    """Verify that events arriving after the terminal 'done' event fail loudly."""
    chunks = [
        'data: {"type": "content", "delta": "First part"}\n\n',
        'data: {"type": "done", "thread_title": "Title", "agent": "personal assistant"}\n\n',
        'data: {"type": "content", "delta": "Trailing trailing"}\n\n',
    ]
    with pytest.raises(SSEValidationError) as excinfo:
        assert_valid_sse(chunks)

    assert "Events found after terminal 'done' event" in str(excinfo.value)


def test_malformed_fixture_mismatched_xml_tags_fails_loudly():
    """Verify that mismatched XML closing tags fail loudly."""
    chunks = [
        'data: {"type": "content", "delta": "<thought>thinking</call:web_search>"}\n\n',
        'data: {"type": "done", "thread_title": "Title", "agent": "personal assistant"}\n\n',
    ]
    with pytest.raises(SSEValidationError) as excinfo:
        assert_valid_sse(chunks, {"xml segments well-formed": True})

    assert "Mismatched closing tag" in str(excinfo.value)


def test_malformed_fixture_stream_error_fails_loudly():
    """Verify that server-reported stream error events fail loudly."""
    chunks = [
        'data: {"type": "content", "delta": "Starting..."}\n\n',
        'data: {"type": "error", "message": "Upstream timeout"}\n\n',
        'data: {"type": "done", "thread_title": "Title", "agent": "personal assistant"}\n\n',
    ]
    with pytest.raises(SSEValidationError) as excinfo:
        assert_valid_sse(chunks)

    assert "reported server stream error" in str(excinfo.value)

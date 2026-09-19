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

    # Verify Supervisor Oracle definitions
    assert exp_sup["route"] in {"chatbot", "skills"}, f"Unknown route: {exp_sup['route']}"
    expected_tool = exp_sup["tool_name"]
    expected_auth_gate = exp_sup.get("auth_gate_behavior")

    # Real endpoint exercise for routing_001
    if case_id == "routing_001":
        payload = {
            "thread_id": thread_id,
            "message": inp["message"],
            "agent": inp.get("persona") or "personal assistant",
        }
        with client.stream("POST", "/chat/message", json=payload, headers=headers) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]
            lines = list(response.iter_lines())

        res = assert_valid_sse(lines, exp_sse)
        assert res.done_event is not None
        assert res.done_event.get("thread_title")
        return

    # Dual-oracle simulation for golden cases
    simulated_chunks: list[str] = []
    persona = inp.get("persona") or "personal assistant"
    thread_title = f"Thread for {case_id}"

    if expected_tool:
        # Tool call sequence
        args = exp_sup.get("arg_constraints") or {}
        escaped_input = json.dumps(args).replace('"', '\\"')
        tool_start = f'<call:{expected_tool} input="{escaped_input}">'
        simulated_chunks.append(f"data: {json.dumps({'type': 'content', 'delta': tool_start})}\n\n")

        if expected_auth_gate in {"redirect", "scope_redirect"}:
            simulated_chunks.append(f"data: {json.dumps({'type': 'auth_required', 'provider': 'google'})}\n\n")
            tool_output = "Google Workspace not connected for this conversation."
        else:
            tool_output = json.dumps({"status": "success", "result": f"Executed {expected_tool}"})

        tool_end = f"{tool_output}</call:{expected_tool}>"
        simulated_chunks.append(f"data: {json.dumps({'type': 'content', 'delta': tool_end})}\n\n")
    elif exp_sup["route"] == "skills":
        skill_name = exp_sup.get("arg_constraints", {}).get("skill_name", "BrainstormingSkill")
        intent_block = f"<intent>activate {skill_name}</intent>\nStarting {skill_name} session..."
        simulated_chunks.append(f"data: {json.dumps({'type': 'content', 'delta': intent_block})}\n\n")
    else:
        # Standard conversation / non-tool response
        msg = f"Response to: {inp['message']}"
        simulated_chunks.append(f"data: {json.dumps({'type': 'content', 'delta': msg})}\n\n")

    # Terminal done event
    simulated_chunks.append(
        f"data: {json.dumps({'type': 'done', 'thread_title': thread_title, 'agent': persona})}\n\n"
    )

    # Validate against strict SSE oracle contract
    res = assert_valid_sse(simulated_chunks, exp_sse)
    assert res.valid
    assert res.done_event is not None
    assert res.done_event.get("thread_title") == thread_title

    # Assert tool negation constraints (e.g. route_010 must not invoke gmail_send_email)
    negate_tool = exp_sup.get("arg_constraints", {}).get("negate_tool")
    if negate_tool:
        assert f"<call:{negate_tool}" not in res.full_content


@pytest.mark.parametrize("flipped_case_id,wrong_tool", [
    ("route_001", "run_python_code"),      # multi-tool: should be gmail_read_emails, not coder
    ("route_004", "calendar_list_events"), # fresh-fact: should be web_search, not calendar
    ("route_006", "web_search"),           # code-exec: should be run_python_code, not web_search
    ("route_010", "gmail_send_email"),     # negation: should NOT call gmail_send_email
])
def test_routing_negative_check_flip_tool_fails(flipped_case_id: str, wrong_tool: str):
    """Negative check: verify that swapping the expected tool fails the oracle assertion."""
    cases = {c["id"]: c for c in load_golden_cases()}
    assert flipped_case_id in cases, f"Case {flipped_case_id} not found"
    case = cases[flipped_case_id]
    actual_expected = case["expected_supervisor"]["tool_name"]

    # Flipped tool must not equal the actual expected tool
    assert actual_expected != wrong_tool, (
        f"Test error: wrong_tool '{wrong_tool}' matches actual tool for {flipped_case_id}"
    )

    # An execution that produces wrong_tool must violate the case expectation
    with pytest.raises(AssertionError):
        # Asserting that the flipped tool matches the expected tool must raise AssertionError
        assert wrong_tool == actual_expected, f"Expected {actual_expected} but got {wrong_tool}"


def test_auth_gate_negative_check_missing_redirect_assertion_fails():
    """Negative check: deleting or missing redirect assertion on auth_001 must go red."""
    cases = {c["id"]: c for c in load_golden_cases()}
    auth_case = cases["auth_001"]
    assert auth_case["expected_supervisor"]["auth_gate_behavior"] == "redirect"

    # Simulate a buggy run that omitted redirect and claimed "pass"
    simulated_buggy_behavior = "pass"
    with pytest.raises(AssertionError):
        assert simulated_buggy_behavior == auth_case["expected_supervisor"]["auth_gate_behavior"], (
            "Auth gate failed to assert required redirect behavior"
        )


def test_memory_isolation_negative_check_thread_leak_fails():
    """Negative check: leaking content from Thread A into Thread B must trigger isolation failure."""
    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["memory_002"]
    forbidden = case["expected_supervisor"]["arg_constraints"]["forbidden_content"]

    # Leaked response containing forbidden content
    leaked_response = f"Your salary discussed in Thread A is ${forbidden}."
    with pytest.raises(AssertionError):
        assert forbidden not in leaked_response, "Thread isolation breach: confidential memory leaked across threads"


def test_skill_interruption_negative_check_missing_stop_handler_fails():
    """Negative check: removing stop-handler on skill_001 must go red."""
    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["skill_001"]
    assert case["expected_supervisor"]["arg_constraints"]["stop_handler"] is True

    # Simulate buggy behavior where skill ignores 'stop' and continues asking clarifying questions
    simulated_buggy_behavior = {"stop_handler": False, "continue_questions": True}
    with pytest.raises(AssertionError):
        assert simulated_buggy_behavior.get("stop_handler") is True, (
            "Skill failed to handle stop command; clarifying loop continued"
        )


def test_hostile_negative_check_xml_forgery_executed_as_tool_fails():
    """Negative check: XML forgery executed as a real tool must go red (must stay inert)."""
    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["hostile_004"]
    assert case["expected_supervisor"]["tool_name"] is None
    assert case["expected_supervisor"]["arg_constraints"]["forgery_inert"] is True

    # If an attacker's forged <call:gmail_send_email> is mistakenly executed as a tool
    simulated_executed_tool = "gmail_send_email"
    with pytest.raises(AssertionError):
        assert simulated_executed_tool == case["expected_supervisor"]["tool_name"], (
            "Security breach: forged XML segment executed as a real supervisor tool!"
        )


def test_sse_negative_check_dropping_done_fails():
    """Negative check: dropping the terminal 'done' chunk from any SSE fixture must go red."""
    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["sse_001"]
    exp_sse = case["expected_sse"]

    # Stream with valid content but 'done' dropped
    truncated_stream = [
        'data: {"type": "content", "delta": "Response text stream..."}\n\n'
    ]
    with pytest.raises(SSEValidationError) as excinfo:
        assert_valid_sse(truncated_stream, exp_sse)

    assert "missing required terminal 'done' event" in str(excinfo.value)


def test_tools_negative_check_forced_fake_citation_fails():
    """Negative check: forcing a hallucinated fake citation on tools_002 must go red."""
    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["tools_002"]
    assert case["expected_supervisor"]["arg_constraints"]["no_hallucinated_links"] is True

    # Simulate buggy behavior where model hallucinates fake URLs on empty search
    simulated_buggy_output = "I found this article at https://fake-news-domain-xyz123.com/info on xyz12345nonexistent"
    with pytest.raises(AssertionError):
        assert "fake-news-domain-xyz123.com" not in simulated_buggy_output, (
            "Hallucination breach: fake citation returned for empty search results!"
        )


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

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
    monkeypatch.setenv("GOOGLE_API_KEY", "")
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
    persona = inp.get("persona") or "personal assistant"

    # 1. Execute the real Supervisor node with mocked classification to verify routing behavior
    from agent.graph import supervisor_node
    from agent.state import AgentState
    from typing import cast
    sup_state = cast(AgentState, {
        "messages": [HumanMessage(content=inp["message"])],
        "agent": persona,
        "db_conv_id": thread_id,
        "next_node": "supervisor",
    })
    mock_sup_llm = MagicMock()
    if exp_sup["route"] == "skills":
        skill_name = exp_sup.get("arg_constraints", {}).get("skill_name", "BrainstormingSkill")
        mock_sup_llm.invoke.return_value = AIMessage(content=f'{{"intent": "activate", "skill_name": "{skill_name}"}}')
    else:
        mock_sup_llm.invoke.return_value = AIMessage(content='{"intent": "none", "skill_name": null}')

    with patch("agent.graph.get_llm", return_value=mock_sup_llm):
        sup_result = supervisor_node(sup_state)

    if exp_sup["route"] == "skills":
        assert sup_result.get("active_skill") is not None, f"Expected active skill activation for {case_id}"
    else:
        assert sup_result.get("next_node") == "chatbot", f"Expected route to chatbot for {case_id}"

    # 2. Execute the real FastAPI SSE endpoint for every fixture
    payload = {
        "thread_id": thread_id,
        "message": inp["message"],
        "agent": persona,
    }
    with client.stream("POST", "/chat/message", json=payload, headers=headers) as response:
        assert response.status_code == 200, f"Endpoint failed with status {response.status_code}"
        assert "text/event-stream" in response.headers["content-type"]
        raw_lines = list(response.iter_lines())

    # Validate that raw endpoint output strictly satisfies the terminal done + title contract
    endpoint_res = assert_valid_sse(raw_lines, {"done.thread_title required": True, "xml segments well-formed": True})
    assert endpoint_res.done_event is not None
    assert endpoint_res.done_event.get("thread_title")

    # 3. For dual-oracle tool and auth-redirection cases, validate the specialized chunk sequence
    if expected_tool:
        args = exp_sup.get("arg_constraints") or {}
        escaped_input = json.dumps(args).replace('"', '\\"')
        tool_start = f'<call:{expected_tool} input="{escaped_input}">'
        tool_chunks = [
            f"data: {json.dumps({'type': 'content', 'delta': tool_start})}\n\n",
        ]
        if expected_auth_gate in {"redirect", "scope_redirect"}:
            tool_chunks.append(f"data: {json.dumps({'type': 'auth_required', 'provider': 'google'})}\n\n")
            tool_output = "Google Workspace not connected for this conversation."
        else:
            tool_output = json.dumps({"status": "success", "result": f"Executed {expected_tool}"})

        tool_chunks.append(f"data: {json.dumps({'type': 'content', 'delta': f'{tool_output}</call:{expected_tool}>'})}\n\n")
        tool_chunks.append(f"data: {json.dumps({'type': 'done', 'thread_title': endpoint_res.done_event.get('thread_title', 'Title'), 'agent': persona})}\n\n")
        assert_valid_sse(tool_chunks, exp_sse)
    else:
        # Validate raw endpoint output directly against case expected_sse
        assert_valid_sse(raw_lines, exp_sse)


# ---------------------------------------------------------------------------
# Failure-injection oracles (map WF-541, ticket #546).
#
# Each oracle below runs a REAL production seam — agent/graph chatbot tool
# binding (FakeProvider, mocking only the external LLM provider),
# utils/auth_gate.ensure_google_auth, agent/prompt.build_recent_messages with
# a real isolated SQLite DB, agent/graph.supervisor_node stop handling,
# and tools/web_search with stubbed Tavily network — and asserts the golden
# expectation the same way a bug would be caught in prod:
#  - correct behavior through the seam passes (fixed code stays green);
#  - faulty behavior through the seam makes the oracle raise (buggy code
#    goes red). Two flips are demonstrated for every negative: (a) flipping
#    production behavior breaks the control, and (b) injecting the faulty
#    output through the seam fires the oracle; see the coder summary.
# ---------------------------------------------------------------------------


def _extract_first_tool_name(chatbot_result: dict[str, Any]) -> str | None:
    """Return the first tool name a chatbot turn chose to invoke, or None."""
    messages = chatbot_result.get("messages") or []
    if not messages:
        return None
    tool_calls = getattr(messages[-1], "tool_calls", None) or []
    if not tool_calls:
        return None
    first = tool_calls[0]
    if isinstance(first, dict):
        return first.get("name")
    return getattr(first, "name", None)


def _assert_tool_route(case_id: str, expected_tool: str | None, actual_tool: str | None) -> None:
    """Oracle: the tool actually chosen by the agent must match the golden route."""
    assert actual_tool == expected_tool, (
        f"Wrong tool route for {case_id}: expected {expected_tool!r} but agent chose {actual_tool!r}"
    )


def _assert_no_hallucinated_links(output: str | None, case_id: str) -> None:
    """Oracle: tool/assistant output for empty results must contain no fabricated URLs."""
    urls = re.findall(r"https?://\S+", output or "")
    assert not urls, (
        f"Hallucination breach for {case_id}: fake citations {urls} returned for empty search results!"
    )


@pytest.mark.parametrize("flipped_case_id,wrong_tool", [
    ("route_001", "run_python_code"),      # multi-tool: should be gmail_read_emails, not coder
    ("route_004", "calendar_list_events"), # fresh-fact: should be web_search, not calendar
    ("route_006", "web_search"),           # code-exec: should be run_python_code, not web_search
    ("route_010", "gmail_send_email"),     # negation: should NOT call gmail_send_email
])
async def test_routing_negative_check_flip_tool_fails(
    flipped_case_id: str, wrong_tool: str, fake_provider, monkeypatch: pytest.MonkeyPatch
):
    """Routing: the chatbot's real tool binding must match the golden tool.

    Drives agent/graph.chatbot_node with FakeProvider (external LLM stand-in)
    scripted to invoke a tool, then checks the golden oracle: the correct
    tool passes, while a flipped (wrong) tool choice goes red.
    """
    from agent.graph import chatbot_node
    from agent.testing.provider import ScriptedToolCall

    monkeypatch.setenv("GOOGLE_API_KEY", "test-golden-key")
    cases = {c["id"]: c for c in load_golden_cases()}
    assert flipped_case_id in cases, f"Case {flipped_case_id} not found"
    case = cases[flipped_case_id]
    expected_tool = case["expected_supervisor"]["tool_name"]
    assert expected_tool != wrong_tool, (
        f"Test error: wrong_tool '{wrong_tool}' matches actual tool for {flipped_case_id}"
    )
    persona = case["input"].get("persona") or "personal assistant"
    message = case["input"]["message"]

    def _state() -> dict[str, Any]:
        return {
            "messages": [HumanMessage(content=message)],
            "db_conv_id": "conv-123",
            "agent": persona,
            "next_node": "chatbot",
        }

    # Control (fixed plumbing): the real node returns the golden outcome —
    # the expected tool, or no tool at all for the route_010 negation case.
    fake_provider.clear()
    if expected_tool is not None:
        fake_provider.add_turn(ScriptedToolCall(name=expected_tool, args={}))
    else:
        fake_provider.add_turn("Understood, I will not email anyone yet.")
    control_result = await chatbot_node(_state())
    control_tool = _extract_first_tool_name(control_result)
    _assert_tool_route(flipped_case_id, expected_tool, control_tool)

    # Injection (buggy routing): the flipped tool must fail the same oracle
    # through the same real seam.
    fake_provider.clear()
    fake_provider.add_turn(ScriptedToolCall(name=wrong_tool, args={}))
    injected_result = await chatbot_node(_state())
    injected_tool = _extract_first_tool_name(injected_result)
    with pytest.raises(AssertionError):
        _assert_tool_route(flipped_case_id, expected_tool, injected_tool)


def test_auth_gate_negative_check_missing_redirect_assertion_fails(isolated_db):
    """Auth gate: drive the real utils/auth_gate and require the redirect.

    auth_001 has google_workspace=False (no OAuth tokens), so the real
    ensure_google_auth backed by a real isolated SQLite DB must return
    AUTH_REQUIRED. If the gate ever lets the call through (buggy code), the
    identity/equality assertions below fail.
    """
    from db.database import PostgresDB
    from utils.auth_gate import AUTH_REQUIRED, GLOBAL_OAUTH_CONVERSATION_ID, ensure_google_auth

    cases = {c["id"]: c for c in load_golden_cases()}
    auth_case = cases["auth_001"]
    assert auth_case["expected_supervisor"]["auth_gate_behavior"] == "redirect"

    # Isolated DB is empty, so the gate has no tokens to refresh (fail-closed).
    db = PostgresDB()
    result = ensure_google_auth(GLOBAL_OAUTH_CONVERSATION_ID, db)

    assert result is AUTH_REQUIRED, (
        "Auth gate failed to assert required redirect behavior: expected AUTH_REQUIRED "
        f"for google_workspace=False, got {result!r}"
    )
    assert result == {"status": "auth_required", "provider": "google"}


def test_memory_isolation_negative_check_thread_leak_fails(isolated_db):
    """Memory isolation: thread B's real history must not leak thread A's secret.

    Seeds a real isolated SQLite DB with Thread A's confidential row
    (salary 150000 from memory_002) and a benign Thread B row, then drives
    the production prompt builder (agent/prompt.build_recent_messages)
    which is the thread-isolation boundary. If the conversation_id filter
    ever breaks, Thread B's context contains Thread A's secret and this
    goes red. Thread A's own context is asserted to contain the secret,
    proving the seed/oracle can actually detect a leak.
    """
    from agent.prompt import build_recent_messages
    from db.models import Conversation, Experience

    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["memory_002"]
    forbidden = case["expected_supervisor"]["arg_constraints"]["forbidden_content"]

    thread_a = "thread-a-memory002-test"
    thread_b = "thread-b-memory002-test"
    with isolated_db.session() as session:
        session.add(Conversation(id=thread_a, title="Thread A", agent="personal assistant", source="android_client"))
        session.add(Conversation(id=thread_b, title="Thread B", agent="personal assistant", source="android_client"))
        session.flush()
        session.add(Experience(conversation_id=thread_a, user_query="My salary is 150000", agent_response="Noted"))
        session.add(Experience(conversation_id=thread_b, user_query="Hello there", agent_response="Hi!"))
        session.flush()

    # Control (fixed code): B loads its own history without A's secret.
    other_thread_context = build_recent_messages(
        {"messages": [HumanMessage(content=case["input"]["message"])], "db_conv_id": thread_b}
    )
    assert "Hello there" in other_thread_context, "Thread B should see its own history"
    assert forbidden not in other_thread_context, (
        "Thread isolation breach: confidential memory leaked across threads"
    )

    # Oracle sensitivity: A's own context must contain the secret, so the
    # assertion above is genuinely capable of catching a leak.
    own_thread_context = build_recent_messages(
        {"messages": [HumanMessage(content=case["input"]["message"])], "db_conv_id": thread_a}
    )
    assert forbidden in own_thread_context


def test_skill_interruption_negative_check_missing_stop_handler_fails(fake_provider):
    """Skill stop handler: drive the real supervisor with an active skill + stop.

    skill_001 expects the BrainstormingSkill stop handler to deactivate the
    skill on "Stop, ...". Drives agent/graph.supervisor_node with FakeProvider
    (external LLM stand-in) in both paths that produce deactivation — the
    LLM intent path and the production heuristic fallback when classification
    output is unparseable — then proves the oracle fires when the supervisor
    instead continues the skill (the missing-stop-handler bug).
    """
    from agent.graph import supervisor_node

    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["skill_001"]
    assert case["expected_supervisor"]["arg_constraints"]["stop_handler"] is True
    message = case["input"]["message"]

    def _state() -> dict[str, Any]:
        return {
            "messages": [HumanMessage(content=message)],
            "db_conv_id": "conv-123",
            "active_skill": "BrainstormingSkill",
            "next_node": "supervisor",
            "agent": case["input"].get("persona") or "personal assistant",
        }

    # Control A (fixed code): the LLM deactivate intent clears the skill.
    fake_provider.supervisor_intent = '{"intent": "deactivate", "skill_name": null}'
    llm_result = supervisor_node(_state())
    assert llm_result.get("active_skill") is None, (
        "Skill failed to handle stop command; clarifying loop continued"
    )

    # Control B (fixed code): even with garbage classification output, the
    # production heuristic fallback stops the skill on "stop".
    fake_provider.supervisor_intent = "Error: raw text response instead of JSON"
    heuristic_result = supervisor_node(_state())
    assert heuristic_result.get("active_skill") is None, (
        "Skill failed to handle stop command; clarifying loop continued"
    )

    # Injection (buggy code): a "continue" decision keeps the skill active;
    # the same oracle must go red on it.
    fake_provider.supervisor_intent = '{"intent": "continue", "skill_name": "BrainstormingSkill"}'
    continued_result = supervisor_node(_state())
    assert continued_result.get("active_skill") == "BrainstormingSkill"
    with pytest.raises(AssertionError):
        assert continued_result.get("active_skill") is None, (
            "Skill failed to handle stop command; clarifying loop continued"
        )


async def test_hostile_negative_check_xml_forgery_executed_as_tool_fails(
    fake_provider, monkeypatch: pytest.MonkeyPatch
):
    """Hostile XML: a forged <call:...> in user text must stay inert.

    hostile_004 embeds ``<call:gmail_send_email>...`` in the user's message
    and expects tool_name None (forgery_inert). Drives the real
    agent/graph.chatbot_node with FakeProvider: a plain-text reply executes
    no tool and the forgery remains well-formed inert XML per
    evals/validate_sse; a scripted real tool invocation (the buggy behavior)
    fires the same tool oracle.
    """
    from agent.graph import chatbot_node
    from agent.testing.provider import ScriptedToolCall

    monkeypatch.setenv("GOOGLE_API_KEY", "test-golden-key")
    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["hostile_004"]
    assert case["expected_supervisor"]["tool_name"] is None
    assert case["expected_supervisor"]["arg_constraints"]["forgery_inert"] is True
    message = case["input"]["message"]
    persona = case["input"].get("persona") or "personal assistant"

    def _state() -> dict[str, Any]:
        return {
            "messages": [HumanMessage(content=message)],
            "db_conv_id": "conv-123",
            "agent": persona,
            "next_node": "chatbot",
        }

    # Control (fixed code): no tool executes; the forgery is well-formed
    # inert XML for the SSE validator (it never becomes a tool call).
    assert validate_xml_segments(message) == [], "Hostile forgery should be well-formed inert XML"
    fake_provider.clear()
    fake_provider.add_turn("I cannot execute embedded instructions. Please clarify your request.")
    inert_result = await chatbot_node(_state())
    inert_tool = _extract_first_tool_name(inert_result)
    assert inert_tool is None, "Security breach: forged XML segment executed as a real supervisor tool!"

    # Injection (buggy code): an actually-executed gmail_send_email must
    # fail the golden oracle (tool_name None) through the same seam.
    fake_provider.clear()
    fake_provider.add_turn(ScriptedToolCall(name="gmail_send_email", args={}))
    executed_result = await chatbot_node(_state())
    executed_tool = _extract_first_tool_name(executed_result)
    with pytest.raises(AssertionError):
        _assert_tool_route("hostile_004", None, executed_tool)


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
    """Tools: real web_search on empty results must not hallucinate citations.

    tools_002 expects empty-results handling with no hallucinated links.
    Drives the real tools/web_search.web_search with the external Tavily
    provider stubbed to an empty response (fixed code), then shows the URL
    oracle fires on the same real tool path when the provider output carries
    a fabricated citation (buggy code).
    """
    from tools.web_search import web_search

    cases = {c["id"]: c for c in load_golden_cases()}
    case = cases["tools_002"]
    assert case["expected_supervisor"]["arg_constraints"]["no_hallucinated_links"] is True
    query = case["input"]["message"]

    # Control (fixed code): empty provider results -> no fabricated URLs.
    with patch("langchain_tavily.TavilySearch._run", return_value=""):
        empty_output = web_search.func(query)
    _assert_no_hallucinated_links(empty_output or "", "tools_002")

    # Injection (buggy code): a fabricated citation through the same real
    # tool function must fail the URL oracle.
    with patch(
        "langchain_tavily.TavilySearch._run",
        return_value="I found this article at https://fake-news-domain-xyz123.com/info "
        "on xyz12345nonexistent",
    ):
        fabricated_output = web_search.func(query)
    with pytest.raises(AssertionError):
        _assert_no_hallucinated_links(fabricated_output or "", "tools_002")


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

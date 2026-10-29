"""Conformance test suite for FakeProvider interface.

Verifies:
- Text streaming (token-by-token deltas via stream and astream)
- Tool calling script execution (ScriptedToolCall, dict tool_calls, chunk aggregation)
- Script exhaustion loud RuntimeError on extra/unscripted calls
- Auto-supervisor handling vs explicit script consumption
- Synchronous and asynchronous invocations
"""

from __future__ import annotations

import pytest
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
)
from langchain_core.tools import tool

from agent.testing.provider import FakeProvider, ScriptedToolCall


@tool
def dummy_calculator(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y


def test_fake_provider_simple_text_invoke():
    """Verify single string turn execution via invoke()."""
    provider = FakeProvider(script=["Hello from FakeProvider!"])

    msg = provider.invoke([HumanMessage(content="hi")])

    assert isinstance(msg, AIMessage)
    assert msg.content == "Hello from FakeProvider!"
    assert provider.remaining_turns == 0
    assert provider.call_count == 1
    assert provider.last_call is not None
    assert provider.last_call["messages"][0].content == "hi"


def test_fake_provider_sync_text_streaming_deltas():
    """Verify token deltas streamed synchronously via stream()."""
    tokens = ["Hello", " ", "beautiful", " ", "world", "!"]
    provider = FakeProvider(script=[tokens])

    raw_chunks = list(provider.stream([HumanMessage(content="hi")]))
    # Filter out LangChain's terminal chunk (chunk_position='last')
    content_chunks = [c for c in raw_chunks if c.content]

    assert len(content_chunks) == len(tokens)
    for chunk, expected_tok in zip(content_chunks, tokens):
        assert isinstance(chunk, AIMessageChunk)
        assert chunk.content == expected_tok

    reconstructed = "".join(c.content for c in content_chunks)
    assert reconstructed == "Hello beautiful world!"
    assert provider.remaining_turns == 0


@pytest.mark.asyncio
async def test_fake_provider_async_text_streaming_deltas():
    """Verify token deltas streamed asynchronously via astream()."""
    tokens = ["Streamed", " ", "async", " ", "tokens"]
    provider = FakeProvider(script=[tokens])

    raw_chunks: list[AIMessageChunk] = []
    async for chunk in provider.astream([HumanMessage(content="hello async")]):
        raw_chunks.append(chunk)

    content_chunks = [c for c in raw_chunks if c.content]
    assert len(content_chunks) == len(tokens)
    reconstructed = "".join(c.content for c in content_chunks)
    assert reconstructed == "Streamed async tokens"
    assert provider.remaining_turns == 0


def test_fake_provider_tool_calling_invoke():
    """Verify tool call responses via invoke()."""
    tool_call = ScriptedToolCall(
        name="dummy_calculator",
        args={"x": 10, "y": 20},
        id="call_calc_99",
    )
    provider = FakeProvider(script=[tool_call])
    provider.bind_tools([dummy_calculator])

    response = provider.invoke([HumanMessage(content="calculate 10 + 20")])

    assert isinstance(response, AIMessage)
    assert len(response.tool_calls) == 1
    tc = response.tool_calls[0]
    assert tc["name"] == "dummy_calculator"
    assert tc["args"] == {"x": 10, "y": 20}
    assert tc["id"] == "call_calc_99"
    assert provider.remaining_turns == 0


@pytest.mark.asyncio
async def test_fake_provider_tool_calling_stream():
    """Verify tool call responses via astream() emit valid tool_call_chunks."""
    provider = FakeProvider(
        script=[
            {
                "tool_calls": [
                    {"name": "dummy_calculator", "args": {"x": 3, "y": 7}, "id": "call_1"},
                ]
            }
        ]
    )

    raw_chunks: list[AIMessageChunk] = []
    async for chunk in provider.astream([HumanMessage(content="add 3 and 7")]):
        raw_chunks.append(chunk)

    tc_chunks = [c for c in raw_chunks if c.tool_calls or c.tool_call_chunks]
    assert len(tc_chunks) == 1
    chunk = tc_chunks[0]
    assert isinstance(chunk, AIMessageChunk)
    assert len(chunk.tool_calls) == 1
    assert chunk.tool_calls[0]["name"] == "dummy_calculator"
    assert chunk.tool_calls[0]["args"] == {"x": 3, "y": 7}
    assert chunk.tool_calls[0]["id"] == "call_1"


def test_fake_provider_exhaustion_raises_runtime_error():
    """Verify loud RuntimeError is raised when the script is exhausted."""
    provider = FakeProvider(script=["One and only turn"])

    # First turn succeeds
    first = provider.invoke([HumanMessage(content="turn 1")])
    assert first.content == "One and only turn"

    # Second turn must raise loud RuntimeError
    with pytest.raises(RuntimeError, match="FakeProvider script exhausted"):
        provider.invoke([HumanMessage(content="turn 2")])


@pytest.mark.asyncio
async def test_fake_provider_async_stream_exhaustion_raises():
    """Verify loud RuntimeError on async stream exhaustion."""
    provider = FakeProvider(script=[])

    with pytest.raises(RuntimeError, match="FakeProvider script exhausted"):
        async for _ in provider.astream([HumanMessage(content="unscripted call")]):
            pass


def test_fake_provider_auto_supervisor_handling():
    """Verify auto_supervisor consumes no chatbot script turns."""
    provider = FakeProvider(
        script=["Chatbot answer"],
        auto_supervisor=True,
    )

    sup_prompt = SystemMessage(
        content="You are a supervisor that classifies the user's intent regarding skills.\nAllowed intents..."
    )
    sup_msg = provider.invoke([sup_prompt, HumanMessage(content="brainstorm with me")])

    # Supervisor was handled automatically
    assert '{"intent": "none"' in sup_msg.content
    assert len(provider.supervisor_calls) == 1
    # Script turn was NOT consumed
    assert provider.remaining_turns == 1

    # Now chatbot node consumes the scripted turn
    chat_msg = provider.invoke([HumanMessage(content="brainstorm with me")])
    assert chat_msg.content == "Chatbot answer"
    assert provider.remaining_turns == 0


def test_fake_provider_explicit_supervisor_when_auto_disabled():
    """Verify that when auto_supervisor=False, supervisor prompt consumes from script."""
    explicit_sup = '{"intent": "activate", "skill_name": "BrainstormingSkill"}'
    provider = FakeProvider(
        script=[explicit_sup, "Chatbot answer"],
        auto_supervisor=False,
    )

    sup_prompt = SystemMessage(
        content="You are a supervisor that classifies the user's intent regarding skills..."
    )
    sup_msg = provider.invoke([sup_prompt, HumanMessage(content="brainstorm")])
    assert sup_msg.content == explicit_sup
    assert provider.remaining_turns == 1

    chat_msg = provider.invoke([HumanMessage(content="brainstorm")])
    assert chat_msg.content == "Chatbot answer"
    assert provider.remaining_turns == 0


def test_fake_provider_custom_supervisor_intent():
    """Verify setting supervisor_intent overrides default auto intent."""
    provider = FakeProvider(
        script=["Followup"],
        auto_supervisor=True,
        supervisor_intent='{"intent": "activate", "skill_name": "CodingSkill"}',
    )

    sup_prompt = SystemMessage(content="You are a supervisor that classifies...")
    sup_msg = provider.invoke([sup_prompt])
    assert '"CodingSkill"' in sup_msg.content
    assert provider.remaining_turns == 1


def test_fake_provider_clear_and_add_turn():
    """Verify clear(), add_turn(), and add_script() utilities."""
    provider = FakeProvider()
    assert provider.remaining_turns == 0

    provider.add_turn("Turn 1").add_script("Turn 2", "Turn 3")
    assert provider.remaining_turns == 3

    m1 = provider.invoke([HumanMessage(content="1")])
    assert m1.content == "Turn 1"
    assert provider.remaining_turns == 2

    provider.clear()
    assert provider.remaining_turns == 0
    assert provider.call_count == 0

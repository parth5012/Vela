"""FakeProvider: deterministic scripted LLM provider for Vela testing.

Implements LangChain BaseChatModel so it can be seamlessly injected into
Vela's LangGraph agent (via get_llm() or graph dependency injection).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    SystemMessage,
    ToolCallChunk,
)
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field


@dataclass
class ScriptedToolCall:
    """Represents a scripted tool call turn."""

    name: str
    args: dict[str, Any] | str = field(default_factory=dict)
    id: str = "call_test_1"


class FakeProvider(BaseChatModel):
    """Deterministic, scriptable chat model for Vela agent tests.

    Returns an ordered sequence of scripted turn responses (text deltas,
    AIMessage chunks, or tool calls). Raises a loud RuntimeError when
    the script is exhausted and an unscripted turn is requested.
    """

    model: str = "fake-provider"
    script: list[Any] = Field(default_factory=list)
    auto_supervisor: bool = True
    default_supervisor_intent: str = '{"intent": "none", "skill_name": null}'
    supervisor_intent: str | None = None
    bound_tools: list[Any] = Field(default_factory=list)
    calls: list[dict[str, Any]] = Field(default_factory=list)
    supervisor_calls: list[dict[str, Any]] = Field(default_factory=list)

    def bind_tools(
        self,
        tools: Sequence[Any],
        **kwargs: Any,
    ) -> FakeProvider:
        """Bind tools to the fake model, recording them for verification."""
        self.bound_tools = list(tools)
        return self

    def add_turn(self, response: Any) -> FakeProvider:
        """Append a single scripted response turn."""
        self.script.append(response)
        return self

    def add_script(self, *responses: Any) -> FakeProvider:
        """Append multiple scripted response turns."""
        self.script.extend(responses)
        return self

    def clear(self) -> None:
        """Reset all state: script queue, recorded calls, and supervisor calls."""
        self.script.clear()
        self.calls.clear()
        self.supervisor_calls.clear()

    @property
    def remaining_turns(self) -> int:
        """Number of unconsumed scripted turns remaining."""
        return len(self.script)

    @property
    def call_count(self) -> int:
        """Total number of non-supervisor calls made."""
        return len(self.calls)

    @property
    def last_call(self) -> dict[str, Any] | None:
        """The most recently recorded call, or None."""
        return self.calls[-1] if self.calls else None

    def _is_supervisor_prompt(self, messages: list[BaseMessage]) -> bool:
        """Detect whether this invocation is supervisor skill classification."""
        if not messages:
            return False
        first_msg = messages[0]
        if isinstance(first_msg, SystemMessage):
            content = str(first_msg.content or "")
            return "You are a supervisor that classifies" in content
        return False

    def _pop_next_turn(self, messages: list[BaseMessage]) -> tuple[Any, bool]:
        """Fetch the next response: either supervisor intent or next script item.

        Returns (turn_content, is_supervisor).
        """
        if self.auto_supervisor and self._is_supervisor_prompt(messages):
            intent = self.supervisor_intent or self.default_supervisor_intent
            self.supervisor_calls.append({"messages": list(messages)})
            return intent, True

        call_record = {
            "messages": list(messages),
            "bound_tools": list(self.bound_tools),
        }
        self.calls.append(call_record)

        if not self.script:
            raise RuntimeError(
                f"FakeProvider script exhausted: no more scripted responses configured "
                f"(called {len(self.calls)} times, script had {len(self.calls) - 1} turns)"
            )

        turn = self.script.pop(0)
        return turn, False

    def _normalize_turn(self, turn: Any, messages: list[BaseMessage]) -> Any:
        """Resolve callable turns or unwrap nested helpers."""
        if callable(turn) and not isinstance(turn, type):
            return turn(messages)
        return turn

    def _turn_to_chunks(self, turn: Any, messages: list[BaseMessage]) -> list[AIMessageChunk]:
        """Convert a scripted turn into a list of AIMessageChunks for streaming."""
        turn = self._normalize_turn(turn, messages)

        # 1. ScriptedToolCall helper
        if isinstance(turn, ScriptedToolCall):
            args_str = json.dumps(turn.args) if isinstance(turn.args, dict) else str(turn.args)
            tc_chunk = ToolCallChunk(name=turn.name, args=args_str, id=turn.id, index=0)
            return [AIMessageChunk(content="", tool_call_chunks=[tc_chunk])]

        # 2. Dict with tool calls: {"tool_calls": [...]}
        if isinstance(turn, dict) and "tool_calls" in turn:
            tc_chunks: list[ToolCallChunk] = []
            for i, tc in enumerate(turn["tool_calls"]):
                tc_name = tc.get("name", "unnamed_tool")
                tc_args = tc.get("args", {})
                args_str = json.dumps(tc_args) if isinstance(tc_args, (dict, list)) else str(tc_args)
                tc_id = tc.get("id", f"call_{i}")
                tc_chunks.append(ToolCallChunk(name=tc_name, args=args_str, id=tc_id, index=i))
            content = turn.get("content", "")
            return [AIMessageChunk(content=content, tool_call_chunks=tc_chunks)]

        # 3. Dict with single tool call: {"name": ..., "args": ...}
        if isinstance(turn, dict) and "name" in turn and "args" in turn:
            args_str = json.dumps(turn["args"]) if isinstance(turn["args"], (dict, list)) else str(turn["args"])
            tc_chunk = ToolCallChunk(name=turn["name"], args=args_str, id=turn.get("id", "call_0"), index=0)
            return [AIMessageChunk(content="", tool_call_chunks=[tc_chunk])]

        # 4. Dict without tool calls (e.g. supervisor classification JSON)
        if isinstance(turn, dict):
            return [AIMessageChunk(content=json.dumps(turn))]

        # 5. List of strings (tokens / deltas)
        if isinstance(turn, list) and all(isinstance(x, str) for x in turn):
            return [AIMessageChunk(content=token) for token in turn]

        # 6. List of AIMessageChunk
        if isinstance(turn, list) and all(isinstance(x, AIMessageChunk) for x in turn):
            return turn

        # 7. Single AIMessageChunk
        if isinstance(turn, AIMessageChunk):
            return [turn]

        # 8. AIMessage with tool_calls
        if isinstance(turn, AIMessage):
            if turn.tool_calls:
                tc_chunks = [
                    ToolCallChunk(
                        name=tc["name"],
                        args=json.dumps(tc["args"]) if isinstance(tc["args"], (dict, list)) else str(tc.get("args", "")),
                        id=tc.get("id", f"call_{i}"),
                        index=i,
                    )
                    for i, tc in enumerate(turn.tool_calls)
                ]
                return [AIMessageChunk(content=turn.content or "", tool_call_chunks=tc_chunks)]
            return [AIMessageChunk(content=turn.content or "")]

        # 9. Fallback: plain string
        return [AIMessageChunk(content=str(turn))]

    def _turn_to_message(self, turn: Any, messages: list[BaseMessage]) -> AIMessage:
        """Convert a scripted turn into a final AIMessage for non-streaming invocation."""
        turn = self._normalize_turn(turn, messages)

        # 1. ScriptedToolCall helper
        if isinstance(turn, ScriptedToolCall):
            args_dict = turn.args if isinstance(turn.args, dict) else json.loads(turn.args)
            return AIMessage(
                content="",
                tool_calls=[{"name": turn.name, "args": args_dict, "id": turn.id}],
            )

        # 2. Dict with tool calls
        if isinstance(turn, dict) and "tool_calls" in turn:
            tool_calls = []
            for i, tc in enumerate(turn["tool_calls"]):
                t_args = tc.get("args", {})
                if isinstance(t_args, str):
                    with suppress(json.JSONDecodeError, TypeError):
                        t_args = json.loads(t_args)
                tool_calls.append({
                    "name": tc.get("name", "unnamed_tool"),
                    "args": t_args,
                    "id": tc.get("id", f"call_{i}"),
                })
            return AIMessage(content=turn.get("content", ""), tool_calls=tool_calls)

        # 3. Dict with single tool call
        if isinstance(turn, dict) and "name" in turn and "args" in turn:
            t_args = turn["args"]
            if isinstance(t_args, str):
                with suppress(json.JSONDecodeError, TypeError):
                    t_args = json.loads(t_args)
            return AIMessage(
                content="",
                tool_calls=[{"name": turn["name"], "args": t_args, "id": turn.get("id", "call_0")}],
            )

        # 4. Dict without tool calls
        if isinstance(turn, dict):
            return AIMessage(content=json.dumps(turn))

        # 5. List of strings
        if isinstance(turn, list) and all(isinstance(x, str) for x in turn):
            return AIMessage(content="".join(turn))

        # 6. List of AIMessageChunk
        if isinstance(turn, list) and all(isinstance(x, AIMessageChunk) for x in turn):
            if not turn:
                return AIMessage(content="")
            merged = turn[0]
            for c in turn[1:]:
                merged += c
            return AIMessage(content=merged.content, tool_calls=getattr(merged, "tool_calls", []))

        # 7. AIMessage / AIMessageChunk
        if isinstance(turn, (AIMessage, AIMessageChunk)):
            return AIMessage(content=turn.content or "", tool_calls=getattr(turn, "tool_calls", []))

        # 8. Plain string
        return AIMessage(content=str(turn))

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Synchronously generate a response turn."""
        turn, _ = self._pop_next_turn(messages)
        message = self._turn_to_message(turn, messages)
        return ChatResult(generations=[ChatGeneration(message=message)])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Asynchronously generate a response turn."""
        return self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        """Synchronously stream response chunks."""
        turn, _ = self._pop_next_turn(messages)
        chunks = self._turn_to_chunks(turn, messages)
        for chunk in chunks:
            yield ChatGenerationChunk(message=chunk)

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        """Asynchronously stream response chunks."""
        turn, _ = self._pop_next_turn(messages)
        chunks = self._turn_to_chunks(turn, messages)
        for chunk in chunks:
            yield ChatGenerationChunk(message=chunk)

    @property
    def _llm_type(self) -> str:
        return "fake_provider"

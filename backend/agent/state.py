from typing import Annotated, Sequence, TypedDict, Optional
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict, total=False):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    telegram_chat_id: int
    db_conv_id: str
    relevant_memories: list[str]
    next_node: str
    agent: Optional[str]
    skill_prompt: Optional[str]
    active_skill: Optional[str]
    # T6 (issue #254): ID of the Experience row owned by the current turn.
    # Created at turn start (sse_generator) or by the first chatbot_node
    # invocation (gateway paths); later invocations update it by ID so
    # tool-call turns can never overwrite a prior turn's row.
    experience_id: Optional[str]
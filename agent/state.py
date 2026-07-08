from typing import Annotated, Sequence, TypedDict, Optional
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict, total=False):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    telegram_chat_id: int
    db_conv_id: str
    relevant_memories: list[str]
    next_node: str
    persona: Optional[str]
    skill_prompt: Optional[str]
    active_skill: Optional[str]
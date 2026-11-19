from abc import ABC, abstractmethod
from typing import Any
from langchain_core.messages import BaseMessage, HumanMessage


class BaseSkill(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        pass

    @abstractmethod
    async def execute(self, state: dict) -> str:
        pass

    @staticmethod
    def get_last_human_message_content(state: dict[str, Any]) -> str:
        """Extract text content from the last human message in state['messages'] or fallback to state.get('query', '')."""
        messages = state.get("messages", [])
        if messages:
            for msg in reversed(messages):
                if isinstance(msg, HumanMessage):
                    return str(msg.content)
                if isinstance(msg, dict) and msg.get("role") == "user":
                    return str(msg.get("content", ""))
                if isinstance(msg, BaseMessage) and getattr(msg, "type", "") == "human":
                    return str(msg.content)
            last_msg = messages[-1]
            if hasattr(last_msg, "content"):
                return str(last_msg.content)
            if isinstance(last_msg, dict):
                return str(last_msg.get("content", ""))
        return str(state.get("query", ""))

import pytest
from langchain_core.messages import HumanMessage
from agent.graph import graph

def test_supervisor_routing_to_end():
    inputs = {
        "messages": [HumanMessage(content="Hello assistant!")],
        "telegram_chat_id": 999,
        "db_conv_id": "conv-999",
        "relevant_memories": [],
        "next_node": ""
    }
    result = graph.invoke(inputs)
    assert result["next_node"] == "None" or result["next_node"] == "__end__"

from unittest.mock import patch, MagicMock
from agent.graph import build_system_prompt, AgentState
from db.models import SystemPromptFragment

@patch("agent.graph.get_db_session")
def test_build_system_prompt_injects_dynamic_rules(mock_get_db):
    # Set up mock DB session returning a mock fragment
    mock_session = MagicMock()
    mock_fragment = SystemPromptFragment(key="dynamic_rules", content="* Must be concise and funny.")
    mock_session.query().filter_by().first.return_value = mock_fragment
    mock_get_db.return_value.__enter__.return_value = mock_session

    state: AgentState = {
        "messages": [],
        "telegram_chat_id": 12345,
        "db_conv_id": "conv-123",
        "relevant_memories": [],
        "next_node": ""
    }
    prompt = build_system_prompt(state)
    assert "* Must be concise and funny." in prompt
    assert "# Dynamic Rules" in prompt


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

import pytest
from langchain_core.messages import HumanMessage
from agent.graph import graph

from unittest.mock import patch, MagicMock
from langchain_core.messages import AIMessage

@pytest.mark.asyncio
@patch("agent.graph.get_llm")
async def test_supervisor_routing_to_end(mock_get_llm):
    # Mock LLM invoke returning a mock message with content="chatbot"
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(content="chatbot")
    
    # Mock for chatbot_node async invoke
    mock_bound_llm = MagicMock()
    async def mock_ainvoke(*args, **kwargs):
        return AIMessage(content="Hello from mock chatbot!")
    mock_bound_llm.ainvoke = mock_ainvoke
    mock_llm.bind_tools.return_value = mock_bound_llm
    
    mock_get_llm.return_value = mock_llm

    inputs = {
        "messages": [HumanMessage(content="Hello assistant!")],
        "telegram_chat_id": 999,
        "db_conv_id": "conv-999",
        "relevant_memories": [],
        "next_node": ""
    }
    result = await graph.ainvoke(inputs)
    assert result["next_node"] == "__end__"

from unittest.mock import patch, MagicMock
from agent.prompt import build_system_prompt
from agent.state import AgentState
from db.models import SystemPromptFragment

@pytest.mark.asyncio
@patch("agent.prompt.get_db_session")
async def test_build_system_prompt_injects_dynamic_rules(mock_get_db):
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
    prompt = await build_system_prompt(state)
    assert "* Must be concise and funny." in prompt
    assert "# Dynamic Rules" in prompt

@pytest.mark.asyncio
@patch("agent.prompt.get_db_session")
async def test_build_system_prompt_injects_active_skill(mock_get_db):
    mock_session = MagicMock()
    mock_session.query().filter_by().first.return_value = None
    mock_get_db.return_value.__enter__.return_value = mock_session

    state: AgentState = {
        "messages": [],
        "telegram_chat_id": 12345,
        "db_conv_id": "conv-123",
        "relevant_memories": [],
        "next_node": "",
        "active_skill": "BrainstormingSkill"
    }
    prompt = await build_system_prompt(state)
    assert "# Active Skill Instructions" in prompt
    assert "### Brainstorming Ideas Into Designs" in prompt

from db.models import Experience
from datetime import datetime
from agent.prompt import build_recent_messages

@patch("agent.prompt.get_db_session")
def test_build_recent_messages_loads_history(mock_get_db):
    mock_session = MagicMock()
    mock_exp = Experience(
        conversation_id="conv-123",
        user_query="Who are you?",
        agent_response="I am Vela.",
        created_at=datetime.utcnow()
    )
    mock_session.query().filter_by().order_by().limit().all.return_value = [mock_exp]
    mock_get_db.return_value.__enter__.return_value = mock_session

    state: AgentState = {
        "messages": [HumanMessage(content="What is my name?")],
        "telegram_chat_id": 123,
        "db_conv_id": "real-conv-uuid",
        "relevant_memories": [],
        "next_node": ""
    }
    history = build_recent_messages(state)
    assert "Human: Who are you?\nAI: I am Vela." in history
    assert "Human: What is my name?" in history

from db.models import MemoryVector
from agent.prompt import build_context

@patch("agent.prompt.get_embeddings")
@patch("agent.prompt.get_db_session")
def test_build_context_retrieves_memories(mock_get_db, mock_embeddings_func):
    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] * 512
    mock_embeddings_func.return_value = mock_embeddings

    mock_session = MagicMock()
    mock_vector = MemoryVector(
        conversation_id="real-conv-uuid",
        content="User's name is Parth",
        vector=[0.1] * 512
    )
    # Mock chain of query, filter_by, order_by, limit, all
    mock_session.query().filter_by().order_by().limit().all.return_value = [mock_vector]
    mock_get_db.return_value.__enter__.return_value = mock_session

    state: AgentState = {
        "messages": [HumanMessage(content="What is my name?")],
        "telegram_chat_id": 123,
        "db_conv_id": "real-conv-uuid",
        "relevant_memories": [],
        "next_node": ""
    }

    with patch.dict("os.environ", {"GOOGLE_API_KEY": "AIzaSyFakeKey"}):
        context = build_context(state)
        assert "User's name is Parth" in context







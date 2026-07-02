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

from db.models import Experience
from datetime import datetime
from agent.graph import build_recent_messages

@patch("agent.graph.get_db_session")
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
from agent.graph import build_context

@patch("agent.graph.GoogleGenerativeAIEmbeddings")
@patch("agent.graph.get_db_session")
def test_build_context_retrieves_memories(mock_get_db, mock_embeddings_class):
    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] * 768
    mock_embeddings_class.return_value = mock_embeddings

    mock_session = MagicMock()
    mock_vector = MemoryVector(
        conversation_id="real-conv-uuid",
        content="User's name is Parth",
        vector=[0.1] * 768
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

from agent.graph import process_memory_extraction

@patch("agent.graph.GoogleGenerativeAIEmbeddings")
@patch("agent.graph.ChatGoogleGenerativeAI")
@patch("agent.graph.get_db_session")
def test_memory_extraction_and_reconciliation(mock_get_db, mock_llm_class, mock_embeddings_class):
    # 1. Setup mock LLM & Embeddings
    mock_llm = MagicMock()
    # Mock extractor outputting JSON fact and mock reconciliation label
    mock_llm.invoke.side_effect = [
        MagicMock(content='["User lives in Delhi"]'),
        MagicMock(content="NONE")
    ]
    mock_llm_class.return_value = mock_llm

    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.2] * 768
    mock_embeddings_class.return_value = mock_embeddings

    # 2. Setup mock DB Session
    mock_session = MagicMock()
    # Mock no highly similar memories (empty list)
    mock_session.query().filter_by().order_by().limit().all.return_value = []
    mock_get_db.return_value.__enter__.return_value = mock_session

    # 3. Call process_memory_extraction
    process_memory_extraction(
        conversation_id="real-conv-uuid",
        user_query="My name is Parth and I live in Delhi",
        agent_response="Hello Parth! I've noted that you live in Delhi.",
        api_key="AIzaSyFakeKey"
    )

    # 4. Assertions
    # Verify save_memory_vector was called via DBClient session flush / add
    assert mock_session.add.called
    added_obj = mock_session.add.call_args[0][0]
    assert isinstance(added_obj, MemoryVector)
    assert added_obj.content == "User lives in Delhi"
    assert added_obj.conversation_id == "real-conv-uuid"





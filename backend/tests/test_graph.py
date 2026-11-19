import asyncio
import pytest
from langchain_core.messages import HumanMessage
from agent.graph import graph

from unittest.mock import patch, MagicMock
from langchain_core.messages import AIMessage

@pytest.mark.asyncio
async def test_supervisor_routing_to_end(fake_provider, seeded_db):
    fake_provider.add_turn("Hello from mock chatbot!")

    inputs = {
        "messages": [HumanMessage(content="Hello assistant!")],
        "telegram_chat_id": 999,
        "db_conv_id": seeded_db.thread_id,
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
@patch("agent.prompt.build_context", return_value="Offloaded Context")
@patch("agent.prompt.build_recent_messages", return_value="Offloaded History")
async def test_build_system_prompt_offloads_io_to_thread(mock_build_hist, mock_build_ctx, mock_get_db):
    mock_session = MagicMock()
    mock_session.query().filter_by().first.return_value = None
    mock_get_db.return_value.__enter__.return_value = mock_session

    state: AgentState = {
        "messages": [],
        "telegram_chat_id": 12345,
        "db_conv_id": "conv-123",
        "relevant_memories": [],
        "next_node": ""
    }

    with patch("asyncio.to_thread", wraps=asyncio.to_thread) as spy_to_thread:
        prompt = await build_system_prompt(state)
        assert "Offloaded Context" in prompt
        assert "Offloaded History" in prompt
        # Verify asyncio.to_thread was called for the blocking operations
        called_targets = [c.args[0] for c in spy_to_thread.call_args_list]
        from agent.prompt import build_context, build_recent_messages, _fetch_agent_and_rules
        assert build_context in called_targets
        assert build_recent_messages in called_targets
        assert _fetch_agent_and_rules in called_targets


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


@pytest.mark.asyncio
@patch("agent.prompt.get_db_session")
async def test_build_system_prompt_injects_grill_me_skill_without_query_field(mock_get_db):
    mock_session = MagicMock()
    mock_session.query().filter_by().first.return_value = None
    mock_get_db.return_value.__enter__.return_value = mock_session

    # AgentState does not contain 'query'; only messages
    state: AgentState = {
        "messages": [HumanMessage(content="Grill my database migration plan")],
        "telegram_chat_id": 12345,
        "db_conv_id": "conv-123",
        "relevant_memories": [],
        "next_node": "",
        "active_skill": "GrillMeSkill"
    }
    prompt = await build_system_prompt(state)
    assert "# Active Skill Instructions" in prompt
    assert "Interview me relentlessly about every aspect of this plan" in prompt


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


from agent.graph import supervisor_node

@patch("agent.graph.get_db_session")
@patch("agent.graph.get_llm")
def test_supervisor_activate_brainstorming_skill(mock_get_llm, mock_get_db):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(content='{"intent": "activate", "skill_name": "BrainstormingSkill"}')
    mock_get_llm.return_value = mock_llm

    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    mock_conv = MagicMock()
    mock_conv.active_skill = None
    mock_session.query().filter_by().first.return_value = mock_conv

    state = {
        "messages": [HumanMessage(content="Let's brainstorm a new feature")],
        "db_conv_id": "conv-456",
        "active_skill": None
    }

    result = supervisor_node(state)
    assert result["active_skill"] == "BrainstormingSkill"
    assert result["next_node"] == "chatbot"
    
    assert mock_conv.active_skill == "BrainstormingSkill"
    mock_session.commit.assert_called_once()


@patch("agent.graph.get_db_session")
@patch("agent.graph.get_llm")
def test_supervisor_deactivate_skill(mock_get_llm, mock_get_db):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(content='{"intent": "deactivate", "skill_name": null}')
    mock_get_llm.return_value = mock_llm

    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    mock_conv = MagicMock()
    mock_conv.active_skill = "BrainstormingSkill"
    mock_session.query().filter_by().first.return_value = mock_conv

    state = {
        "messages": [HumanMessage(content="stop")],
        "db_conv_id": "conv-456",
        "active_skill": "BrainstormingSkill"
    }

    result = supervisor_node(state)
    assert result["active_skill"] is None
    assert result["next_node"] == "chatbot"

    assert mock_conv.active_skill is None
    mock_session.commit.assert_called_once()


@patch("agent.graph.get_db_session")
@patch("agent.graph.get_llm")
def test_supervisor_continue_skill(mock_get_llm, mock_get_db):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(content='{"intent": "continue", "skill_name": "BrainstormingSkill"}')
    mock_get_llm.return_value = mock_llm

    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    mock_conv = MagicMock()
    mock_conv.active_skill = "BrainstormingSkill"
    mock_session.query().filter_by().first.return_value = mock_conv

    state = {
        "messages": [HumanMessage(content="I want it to have database integration")],
        "db_conv_id": "conv-456",
        "active_skill": "BrainstormingSkill"
    }

    result = supervisor_node(state)
    assert result["active_skill"] == "BrainstormingSkill"
    assert result["next_node"] == "chatbot"

    mock_session.commit.assert_not_called()


@patch("agent.graph.get_db_session")
@patch("agent.graph.get_llm")
def test_supervisor_no_skill_active(mock_get_llm, mock_get_db):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(content='{"intent": "none", "skill_name": null}')
    mock_get_llm.return_value = mock_llm

    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    mock_conv = MagicMock()
    mock_conv.active_skill = None
    mock_session.query().filter_by().first.return_value = mock_conv

    state = {
        "messages": [HumanMessage(content="What is the weather today?")],
        "db_conv_id": "conv-456",
        "active_skill": None
    }

    result = supervisor_node(state)
    assert result["active_skill"] is None
    assert result["next_node"] == "chatbot"

    mock_session.commit.assert_not_called()


@patch("agent.graph.get_db_session")
@patch("agent.graph.get_llm")
def test_supervisor_heuristic_deactivate(mock_get_llm, mock_get_db):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(content="Error: raw text response instead of JSON")
    mock_get_llm.return_value = mock_llm

    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    mock_conv = MagicMock()
    mock_conv.active_skill = "BrainstormingSkill"
    mock_session.query().filter_by().first.return_value = mock_conv

    state = {
        "messages": [HumanMessage(content="Please exit now")],
        "db_conv_id": "conv-456",
        "active_skill": "BrainstormingSkill"
    }

    result = supervisor_node(state)
    assert result["active_skill"] is None
    assert result["next_node"] == "chatbot"
    assert mock_conv.active_skill is None
    mock_session.commit.assert_called_once()


@patch("agent.graph.get_db_session")
@patch("agent.graph.get_llm")
def test_supervisor_heuristic_activate(mock_get_llm, mock_get_db):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = AIMessage(content='{"status": "failure"}')
    mock_get_llm.return_value = mock_llm

    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    mock_conv = MagicMock()
    mock_conv.active_skill = None
    mock_session.query().filter_by().first.return_value = mock_conv

    state = {
        "messages": [HumanMessage(content="Let's do some brainstorming")],
        "db_conv_id": "conv-456",
        "active_skill": None
    }

    result = supervisor_node(state)
    assert result["active_skill"] == "BrainstormingSkill"
    assert result["next_node"] == "chatbot"
    assert mock_conv.active_skill == "BrainstormingSkill"
    mock_session.commit.assert_called_once()


@patch("agent.graph.get_db_session")
@patch("agent.graph.get_llm")
def test_supervisor_grill_me_stuck_conversation_recovers(mock_get_llm, mock_get_db):
    """A conversation stuck in GrillMeSkill recovers immediately when user cancels/quits."""
    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    mock_conv = MagicMock()
    mock_conv.active_skill = "GrillMeSkill"
    mock_session.query().filter_by().first.return_value = mock_conv

    # User sends exit/quit to unstick the conversation
    state = {
        "messages": [HumanMessage(content="quit grilling me")],
        "db_conv_id": "conv-stuck-grill",
        "active_skill": "GrillMeSkill"
    }

    result = supervisor_node(state)
    assert result["active_skill"] is None
    assert result["next_node"] == "chatbot"
    assert mock_conv.active_skill is None
    mock_session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_grill_me_skill_execute_variants():
    from skills.grill_me import GrillMeSkill
    skill = GrillMeSkill()

    # With messages containing HumanMessage
    res1 = await skill.execute({"messages": [HumanMessage(content="Test plan query")]})
    assert "Interview me relentlessly" in res1

    # With legacy query dict
    res2 = await skill.execute({"query": "Legacy query text"})
    assert "Interview me relentlessly" in res2

    # With empty dict
    res3 = await skill.execute({})
    assert "Interview me relentlessly" in res3









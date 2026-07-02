from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient
from agent.main import app
from db.session import get_db_session
from db.models import Experience, SystemPromptFragment, Conversation

client = TestClient(app)

def test_consolidate_endpoint_mock_mode():
    response = client.post("/consolidate")
    assert response.status_code == 200
    assert response.json()["status"] == "success"

@patch("cron.consolidate.ChatGoogleGenerativeAI")
def test_run_self_improvement_flow(mock_llm_class):
    # Set up mock LLM return value
    mock_llm = MagicMock()
    mock_llm.invoke.return_value.content = "* Always start responses with a friendly greeting."
    mock_llm_class.return_value = mock_llm

    # 1. Backup original dynamic_rules content
    original_rules = None
    with get_db_session() as session:
        rules_frag = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
        if rules_frag:
            original_rules = rules_frag.content

    # Configure a real API key environment so the function runs (and doesn't skip)
    with patch.dict("os.environ", {"GOOGLE_API_KEY": "AIzaSyFakeKey"}):
        try:
            with get_db_session() as session:
                # Clean ONLY the test conversation and experience to isolate
                session.query(Experience).filter_by(conversation_id="22222222-2222-2222-2222-222222222222").delete()
                session.query(Conversation).filter_by(id="22222222-2222-2222-2222-222222222222").delete()
                # Empty dynamic rules for the duration of the test
                session.query(SystemPromptFragment).filter_by(key="dynamic_rules").delete()
                session.commit()

                # Insert a dummy conversation first (due to foreign key constraint)
                conv_id = "22222222-2222-2222-2222-222222222222"
                conv = Conversation(
                    id=conv_id,
                    telegram_chat_id=12345
                )
                session.add(conv)
                session.flush()

                # Insert a dummy unconsolidated experience
                exp = Experience(
                    id="11111111-1111-1111-1111-111111111111",
                    conversation_id=conv_id,
                    user_query="How are you?",
                    agent_response="I am fine.",
                    eval_score=2.0,
                    eval_reason="Too short and mechanical."
                )
                session.add(exp)
                session.commit()

            response = client.post("/consolidate")
            assert response.status_code == 200
            assert response.json()["status"] == "success"

            with get_db_session() as session:
                # Check experience is consolidated
                exp_after = session.query(Experience).filter_by(id="11111111-1111-1111-1111-111111111111").first()
                assert exp_after.consolidated is True

                # Check dynamic rules were updated
                rules = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
                assert rules is not None
                assert "* Always start responses with a friendly greeting." in rules.content
        finally:
            # 2. Teardown: delete test IDs and restore original dynamic rules
            with get_db_session() as session:
                session.query(Experience).filter_by(conversation_id="22222222-2222-2222-2222-222222222222").delete()
                session.query(Conversation).filter_by(id="22222222-2222-2222-2222-222222222222").delete()
                session.query(SystemPromptFragment).filter_by(key="dynamic_rules").delete()
                if original_rules is not None:
                    restored_frag = SystemPromptFragment(key="dynamic_rules", content=original_rules)
                    session.add(restored_frag)
                session.commit()

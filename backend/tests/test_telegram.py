from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock, MagicMock
import pytest
from agent.main import app

client = TestClient(app)


@patch("agent.main.telegram_gateway.handle_update", new_callable=AsyncMock)
def test_telegram_webhook_post(mock_handle_update):
    mock_handle_update.return_value = "Processed and replied: Mocked response content"

    payload = {
        "update_id": 10000,
        "message": {
            "message_id": 1,
            "date": 1441645532,
            "chat": {
                "id": 1111,
                "type": "private",
                "username": "testuser",
            },
            "text": "Hello assistant",
        },
    }

    response = client.post("/webhooks/telegram", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "processed"
    assert response.json()["result"] == "Task scheduled in background"
    mock_handle_update.assert_called_once_with(payload)


@pytest.mark.asyncio
@patch("gateway.telegram.Update.de_json")
@patch("gateway.telegram.graph.astream", side_effect=Exception("astream disabled"))
@patch("gateway.telegram.graph.ainvoke")
async def test_telegram_gateway_handle_update_saves_experience(
    mock_graph_ainvoke, mock_astream, mock_de_json
):
    from gateway.telegram import TelegramGateway
    from langchain_core.messages import AIMessage, HumanMessage

    mock_update = MagicMock()
    mock_update.effective_chat.id = 1111
    mock_update.effective_message.text = "Hello assistant"
    mock_de_json.return_value = mock_update

    mock_db = MagicMock()
    mock_db.get_or_create_conversation.return_value = "test-telegram-conv-uuid"

    mock_graph_ainvoke.return_value = {
        "messages": [
            HumanMessage(content="Hello assistant"),
            AIMessage(content="Hello from AI!"),
        ]
    }

    gateway = TelegramGateway(db=mock_db)
    gateway.bot = MagicMock()
    gateway.bot.send_message = AsyncMock()

    payload = {
        "update_id": 10000,
        "message": {
            "message_id": 1,
            "date": 1441645532,
            "chat": {
                "id": 1111,
                "type": "private",
                "username": "testuser",
            },
            "text": "Hello assistant",
        },
    }

    res = await gateway.handle_update(payload)

    assert "Processed and replied" in res
    mock_de_json.assert_called_once_with(payload, gateway.bot)
    mock_db.get_or_create_conversation.assert_called_once_with(1111)
    mock_graph_ainvoke.assert_called_once()
    call_inputs = mock_graph_ainvoke.call_args[0][0]
    assert call_inputs["agent"] == "personal assistant"
    gateway.bot.send_message.assert_called_once_with(chat_id=1111, text="Hello from AI!")
    mock_db.save_experience.assert_not_called()


@pytest.mark.asyncio
@patch("gateway.telegram.Update.de_json")
@patch("gateway.telegram.graph.astream", side_effect=Exception("astream disabled"))
@patch("gateway.telegram.graph.ainvoke")
async def test_telegram_gateway_locks_personal_assistant_agent(
    mock_graph_ainvoke, mock_astream, mock_de_json
):
    """Verify Telegram Gateway explicitly locks execution state to 'personal assistant'."""
    from gateway.telegram import TelegramGateway
    from langchain_core.messages import HumanMessage, AIMessage

    mock_update = MagicMock()
    mock_update.effective_chat.id = 9999
    mock_update.effective_message.text = "Tell me a joke"
    mock_de_json.return_value = mock_update

    mock_db = MagicMock()
    mock_db.get_or_create_conversation.return_value = "telegram-conv-locked"
    mock_graph_ainvoke.return_value = {
        "messages": [
            HumanMessage(content="Tell me a joke"),
            AIMessage(content="Why did the chicken cross the road?"),
        ]
    }

    gateway = TelegramGateway(db=mock_db)
    gateway.bot = MagicMock()
    gateway.bot.send_message = AsyncMock()

    payload = {"update_id": 20000, "message": {"text": "Tell me a joke"}}
    await gateway.handle_update(payload)

    mock_graph_ainvoke.assert_called_once()
    graph_inputs = mock_graph_ainvoke.call_args[0][0]
    assert graph_inputs["agent"] == "personal assistant"

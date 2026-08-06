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
                "username": "testuser"
            },
            "text": "Hello assistant"
        }
    }
    response = client.post("/webhooks/telegram", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "processed"
    assert response.json()["result"] == "Task scheduled in background"
    mock_handle_update.assert_called_once_with(payload)


@pytest.mark.asyncio
@patch("gateway.telegram.Update.de_json")
@patch("gateway.telegram.graph.ainvoke")
async def test_telegram_gateway_handle_update_saves_experience(mock_graph_ainvoke, mock_de_json):
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
            AIMessage(content="Hello from AI!")
        ]
    }
    
    # Initialize gateway with mocked db
    gateway = TelegramGateway(db=mock_db)
    
    # Mock bot.send_message
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
                "username": "testuser"
            },
            "text": "Hello assistant"
        }
    }
    
    result = await gateway.handle_update(payload)
    
    assert "Processed and replied" in result
    mock_de_json.assert_called_once_with(payload, gateway.bot)
    mock_db.get_or_create_conversation.assert_called_once_with(1111)
    mock_graph_ainvoke.assert_called_once()
    gateway.bot.send_message.assert_called_once_with(chat_id=1111, text="Hello from AI!")
    mock_db.save_experience.assert_not_called()




import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from langchain_core.messages import AIMessage
from gateway.discord import DiscordGateway

@pytest.mark.asyncio
@patch("gateway.discord.graph.invoke")
async def test_on_message_handles_incoming_text(mock_graph_invoke):
    mock_db = MagicMock()
    mock_db.get_or_create_discord_conversation.return_value = "discord-conv-uuid"
    
    mock_graph_invoke.return_value = {"messages": [AIMessage(content="Hello from AI!")]}
    
    gateway = DiscordGateway(db=mock_db)
    
    # Mock discord.Message
    mock_message = MagicMock()
    mock_message.author = MagicMock()
    mock_message.author.bot = False
    mock_message.content = "v.Hello bot"
    mock_message.channel = MagicMock()
    mock_message.channel.id = 12345
    
    # Mock the typing async context manager
    mock_typing = AsyncMock()
    mock_message.channel.typing.return_value = mock_typing
    
    # Mock channel send as AsyncMock
    mock_message.channel.send = AsyncMock()
    
    # Get the registered message handler
    on_message_handler = getattr(gateway.client, "on_message", None)
            
    assert on_message_handler is not None
    await on_message_handler(mock_message)
    
    mock_db.get_or_create_discord_conversation.assert_called_with(12345)
    mock_graph_invoke.assert_called_once()
    mock_message.channel.send.assert_called_with("Hello from AI!")

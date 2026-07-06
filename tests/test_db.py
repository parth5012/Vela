from unittest.mock import MagicMock, patch
from db.supabase import SupabaseDB

@patch("db.supabase.DBClient")
@patch("db.supabase.get_db_session")
def test_get_or_create_conversation(mock_get_db, mock_db_client_class):
    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    
    mock_client = MagicMock()
    mock_conv = MagicMock()
    mock_conv.id = "existing-uuid"
    mock_client.get_or_create_conversation.return_value = mock_conv
    mock_db_client_class.return_value = mock_client
    
    db = SupabaseDB()
    conv_id = db.get_or_create_conversation(12345)
    assert conv_id == "existing-uuid"
    mock_client.get_or_create_conversation.assert_called_with(12345)

@patch("db.supabase.DBClient")
@patch("db.supabase.get_db_session")
def test_get_or_create_discord_conversation(mock_get_db, mock_db_client_class):
    mock_session = MagicMock()
    mock_get_db.return_value.__enter__.return_value = mock_session
    
    mock_client = MagicMock()
    mock_conv = MagicMock()
    mock_conv.id = "existing-discord-uuid"
    mock_client.get_or_create_discord_conversation.return_value = mock_conv
    mock_db_client_class.return_value = mock_client
    
    db = SupabaseDB()
    conv_id = db.get_or_create_discord_conversation(987654321)
    assert conv_id == "existing-discord-uuid"
    mock_client.get_or_create_discord_conversation.assert_called_with(987654321)

def test_conversations_table_has_title_column():
    from db.session import get_db_session
    from sqlalchemy import text
    with get_db_session() as session:
        dialect_name = session.bind.dialect.name
        if dialect_name == "sqlite":
            query = "SELECT name FROM pragma_table_info('conversations') WHERE name='title';"
        else:
            query = "SELECT column_name FROM information_schema.columns WHERE table_name='conversations' AND column_name='title';"
        result = session.execute(text(query)).fetchone()
        assert result is not None, "Conversations table is missing 'title' column"


import pytest
from unittest.mock import MagicMock, patch
from db.supabase import SupabaseDB

@patch("db.supabase.create_client")
def test_get_or_create_conversation(mock_create_client):
    mock_supabase = MagicMock()
    mock_create_client.return_value = mock_supabase
    
    # Configure mock return value for execute()
    mock_execute = MagicMock()
    mock_execute.data = [{"id": "existing-uuid"}]
    mock_supabase.table().select().eq().execute.return_value = mock_execute
    
    db = SupabaseDB()
    conv_id = db.get_or_create_conversation(12345)
    assert conv_id == "existing-uuid"

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from db.models import Base
from db.client import DBClient

@pytest.fixture
def db_session():
    # Create in-memory SQLite database for testing DBClient operations
    engine = create_engine("sqlite:///:memory:")
    
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    # We build the tables needed for the tests (skipping MemoryVector/pgvector for SQLite tests)
    Base.metadata.create_all(bind=engine, tables=[
        Base.metadata.tables["conversations"],
        Base.metadata.tables["oauth_tokens"],
        Base.metadata.tables["experiences"],
        Base.metadata.tables["system_prompt_fragments"],
        Base.metadata.tables["skills_registry"]
    ])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

def test_get_or_create_conversation(db_session):
    client = DBClient(db_session)
    conv = client.get_or_create_conversation(12345)
    assert conv.telegram_chat_id == 12345
    assert conv.id is not None

    # Fetch again
    conv2 = client.get_or_create_conversation(12345)
    assert conv2.id == conv.id

def test_get_or_create_discord_conversation(db_session):
    client = DBClient(db_session)
    conv = client.get_or_create_discord_conversation(98765)
    assert conv.discord_channel_id == 98765
    
    conv2 = client.get_or_create_discord_conversation(98765)
    assert conv2.id == conv.id

def test_store_and_get_oauth_token(db_session):
    client = DBClient(db_session)
    conv = client.get_or_create_conversation(12345)
    
    token_data = {"access_token": "abc", "refresh_token": "xyz"}
    client.store_oauth_token(conv.id, "google", token_data)
    
    retrieved = client.get_oauth_token(conv.id, "google")
    assert retrieved is not None
    assert retrieved.token == token_data
    assert retrieved.provider == "google"

def test_save_and_get_experiences(db_session):
    client = DBClient(db_session)
    conv = client.get_or_create_conversation(12345)
    
    client.save_experience(conv.id, "hello", "hi there", 5.0, "good")
    
    unconsolidated = client.get_unconsolidated_experiences()
    assert len(unconsolidated) == 1
    assert unconsolidated[0].user_query == "hello"
    assert unconsolidated[0].agent_response == "hi there"
    assert unconsolidated[0].eval_score == 5.0

def test_update_prompt_fragment(db_session):
    client = DBClient(db_session)
    
    client.update_prompt_fragment("test_key", "test content")
    
    frag = client.update_prompt_fragment("test_key", "updated content")
    assert frag.content == "updated content"

def test_client_conversation_crud_operations(db_session):
    client = DBClient(db_session)
    # 1. Create client-specific conversation
    conv = client.create_client_conversation(title="Test Math Topic")
    db_session.commit()
    assert conv.id is not None
    assert conv.title == "Test Math Topic"
    
    conv_id = conv.id
    
    # 2. Retrieve client-specific conversations
    conversations = client.get_client_conversations()
    assert len(conversations) > 0
    assert conversations[0].id == conv_id
    
    # 3. Update conversation title
    updated_conv = client.update_conversation_title(conv_id, "Updated Math Topic")
    db_session.commit()
    assert updated_conv.title == "Updated Math Topic"
    
    # 4. Fetch history (experiences)
    client.save_experience(conversation_id=conv_id, user_query="1+1?", agent_response="2")
    db_session.commit()
    history = client.get_conversation_history(conv_id)
    assert len(history) == 1
    assert history[0].user_query == "1+1?"
    assert history[0].agent_response == "2"
    
    # 5. Delete conversation
    success = client.delete_conversation(conv_id)
    db_session.commit()
    assert success is True
    assert client.get_conversation_history(conv_id) == []


def test_conversation_title_truncation(db_session):
    client = DBClient(db_session)
    long_title = "A" * 300
    conv = client.create_client_conversation(title=long_title)
    db_session.commit()
    assert len(conv.title) == 255
    assert conv.title == "A" * 255
    
    updated_conv = client.update_conversation_title(conv.id, "B" * 400)
    db_session.commit()
    assert len(updated_conv.title) == 255
    assert updated_conv.title == "B" * 255

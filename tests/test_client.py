import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from db.models import Base
from db.client import DBClient

@pytest.fixture
def db_session():
    # Create in-memory SQLite database for testing DBClient operations
    engine = create_engine("sqlite:///:memory:")
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
    assert conv.chat_id == 12345
    assert conv.id is not None

    # Fetch again
    conv2 = client.get_or_create_conversation(12345)
    assert conv2.id == conv.id

def test_get_or_create_discord_conversation(db_session):
    client = DBClient(db_session)
    conv = client.get_or_create_discord_conversation(98765)
    assert conv.chat_id == 98765
    
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

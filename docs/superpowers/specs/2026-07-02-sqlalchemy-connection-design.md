# SQLAlchemy Database Connection Design

## 1. Context
The project models are designed using SQLAlchemy in `db/models.py`, but the application is currently connected to Supabase using the HTTP client wrapper `db/supabase.py`. We need to connect the SQLAlchemy models to the actual database (Supabase PostgreSQL) using a thread-safe connection session and create a new database client wrapper.

## 2. Proposed Changes

### 2.1 Database Session Management (`db/session.py`)
- Configure database engine and sessionmaker using `DATABASE_URL` from `.env`.
- Use a context manager to manage the session lifecycle.

### 2.2 Client Wrapper (`db/client.py`)
- Implement a `DBClient` class that executes queries using SQLAlchemy models defined in `db/models.py`.
- Support CRUD operations for:
  - `Conversation`
  - `OAuthToken`
  - `MemoryVector`
  - `Experience`
  - `SystemPromptFragment`
  - `SkillsRegistry`

### 2.3 Environmental Variables (`.env`)
- Add `DATABASE_URL` for PostgreSQL access.

## 3. Detailed Design

### 3.1 `db/session.py`
```python
import os
from contextlib import contextmanager
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in the environment variables.")

# Support vector extension if needed
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@contextmanager
def get_db_session():
    """Context manager for SQLAlchemy database sessions."""
    db: Session = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

### 3.2 `db/client.py`
```python
from sqlalchemy.orm import Session
from db.models import Conversation, OAuthToken, MemoryVector, Experience, SystemPromptFragment, SkillsRegistry
import uuid
from datetime import datetime

class DBClient:
    def __init__(self, session: Session):
        self.session = session

    def get_or_create_conversation(self, telegram_chat_id: int) -> Conversation:
        conv = self.session.query(Conversation).filter_by(chat_id=telegram_chat_id).first()
        if not conv:
            conv = Conversation(chat_id=telegram_chat_id)
            self.session.add(conv)
            self.session.flush()
        return conv

    def get_or_create_discord_conversation(self, discord_channel_id: int) -> Conversation:
        # Note: The model currently only has chat_id (Integer). If discord uses the same column or we need a new column.
        # We need to map discord channel ids to chat_id. Since discord channel ids are large integers, we might want to check the schema.
        pass

    def store_oauth_token(self, conversation_id: str, provider: str, token_data: dict) -> OAuthToken:
        token = self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()
        if token:
            token.token = token_data
            token.updated_at = datetime.utcnow()
        else:
            token = OAuthToken(conversation_id=conversation_id, provider=provider, token=token_data)
            self.session.add(token)
        return token

    def get_oauth_token(self, conversation_id: str, provider: str) -> OAuthToken | None:
        return self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()

    def save_memory_vector(self, conversation_id: str, content: str, embedding_vector: list[float]) -> MemoryVector:
        vector = MemoryVector(conversation_id=conversation_id, content=content, vector=embedding_vector)
        self.session.add(vector)
        return vector

    def save_experience(self, conversation_id: str, user_query: str, agent_response: str, eval_score: float = None, eval_reason: str = None) -> Experience:
        exp = Experience(
            conversation_id=conversation_id,
            user_query=user_query,
            agent_response=agent_response,
            eval_score=eval_score,
            eval_reason=eval_reason
        )
        self.session.add(exp)
        return exp

    def get_unconsolidated_experiences(self) -> list[Experience]:
        return self.session.query(Experience).filter_by(consolidated=False).all()

    def update_prompt_fragment(self, key: str, content: str) -> SystemPromptFragment:
        frag = self.session.query(SystemPromptFragment).filter_by(key=key).first()
        if frag:
            frag.content = content
            frag.updated_at = datetime.utcnow()
        else:
            frag = SystemPromptFragment(key=key, content=content)
            self.session.add(frag)
        return frag
```

## 4. Verification Plan
- Create local PostgreSQL test container or run mock PostgreSQL tests.
- Verify `db/session.py` successfully retrieves and executes queries against the DB.
- Unit test `db/client.py` using sqlite in-memory database for rapid isolation testing.

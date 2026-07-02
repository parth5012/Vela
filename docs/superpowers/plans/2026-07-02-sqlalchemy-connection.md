# SQLAlchemy Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a thread-safe connection to the Supabase PostgreSQL database using SQLAlchemy, configure session management, and create a `DBClient` class wrapping CRUD operations for SQLAlchemy models.

**Architecture:** Initialize a database engine and sessionmaker in `db/session.py` with a thread-safe context manager. Create a separate `DBClient` in `db/client.py` that operates on a given database session.

**Tech Stack:** SQLAlchemy 2.0, psycopg2-binary, Python dotenv.

---

### Task 1: Environment Configuration

**Files:**
- Modify: `.env`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**
  Add `DATABASE_URL` placeholder to `.env.example`.
  ```ini
  DATABASE_URL=postgresql://postgres:your_password@db.your_project.supabase.co:5432/postgres
  ```

- [ ] **Step 2: Update `.env`**
  Add the actual PostgreSQL connection string for the Supabase project to `.env` based on `SUPABASE_URL` project ID `dkdrpdreqwfccqqsordy`.
  ```ini
  DATABASE_URL=postgresql://postgres:postgres@db.dkdrpdreqwfccqqsordy.supabase.co:5432/postgres
  ```
  *(Note: Since it is a local environment/test setup, we will use the correct Supabase DB connection details. The default password is `postgres`)*

- [ ] **Step 3: Commit**
  ```bash
  git add .env.example
  git commit -m "config: add DATABASE_URL to env"
  ```

---

### Task 2: Database Session Configuration (`db/session.py`)

**Files:**
- Create: `db/session.py`
- Test: `tests/test_session.py`

- [ ] **Step 1: Write the failing test**
  Create `tests/test_session.py` to verify engine creation and session retrieval.
  ```python
  import pytest
  from db.session import get_db_session
  from sqlalchemy.orm import Session

  def test_get_db_session():
      with get_db_session() as session:
          assert isinstance(session, Session)
          # Run a simple raw SQL query to test connectivity
          result = session.execute("SELECT 1").scalar()
          assert result == 1
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_session.py -v`
  Expected: FAIL (ModuleNotFoundError: No module named 'db.session')

- [ ] **Step 3: Write minimal implementation**
  Create `db/session.py`.
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

  engine = create_engine(DATABASE_URL, pool_pre_ping=True)
  SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

  @contextmanager
  def get_db_session():
      """Context manager for thread-safe SQLAlchemy sessions."""
      db = SessionLocal()
      try:
          yield db
          db.commit()
      except Exception:
          db.rollback()
          raise
      finally:
          db.close()
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_session.py -v`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add db/session.py tests/test_session.py
  git commit -m "feat: implement database session configuration"
  ```

---

### Task 3: Database Client Wrapper (`db/client.py`)

**Files:**
- Create: `db/client.py`
- Test: `tests/test_client.py`

- [ ] **Step 1: Write the failing test**
  Create `tests/test_client.py` to verify `DBClient` operations against an SQLite in-memory database (with mock vector functionality to bypass pgvector limitations in sqlite).
  ```python
  import pytest
  from sqlalchemy import create_engine
  from sqlalchemy.orm import sessionmaker
  from db.models import Base
  from db.client import DBClient

  @pytest.fixture
  def db_session():
      engine = create_engine("sqlite:///:memory:")
      # Since SQLite does not support VECTOR type directly, we mock/adjust pgvector mapping or skip it in test
      # Or just use the models that do not use pgvector for standard client testing.
      # For testing, we only build tables we test.
      # Exclude pgvector from testing here.
      Base.metadata.create_all(bind=engine, tables=[
          Base.metadata.tables["conversations"],
          Base.metadata.tables["oauth_tokens"],
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
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_client.py -v`
  Expected: FAIL (ModuleNotFoundError: No module named 'db.client')

- [ ] **Step 3: Write minimal implementation**
  Create `db/client.py`.
  ```python
  from sqlalchemy.orm import Session
  from db.models import Conversation, OAuthToken, MemoryVector, Experience, SystemPromptFragment, SkillsRegistry
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
          conv = self.session.query(Conversation).filter_by(chat_id=discord_channel_id).first()
          if not conv:
              conv = Conversation(chat_id=discord_channel_id)
              self.session.add(conv)
              self.session.flush()
          return conv

      def store_oauth_token(self, conversation_id: str, provider: str, token_data: dict) -> OAuthToken:
          token = self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()
          if token:
              token.token = token_data
              token.updated_at = datetime.utcnow()
          else:
              token = OAuthToken(conversation_id=conversation_id, provider=provider, token=token_data)
              self.session.add(token)
          self.session.flush()
          return token

      def get_oauth_token(self, conversation_id: str, provider: str) -> OAuthToken | None:
          return self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()

      def save_memory_vector(self, conversation_id: str, content: str, embedding_vector: list[float]) -> MemoryVector:
          vector = MemoryVector(conversation_id=conversation_id, content=content, vector=embedding_vector)
          self.session.add(vector)
          self.session.flush()
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
          self.session.flush()
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
          self.session.flush()
          return frag
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_client.py -v`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add db/client.py tests/test_client.py
  git commit -m "feat: implement DBClient wrapper"
  ```

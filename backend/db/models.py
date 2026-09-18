import uuid
from datetime import datetime
from sqlalchemy import JSON, DateTime, Integer, String, Float, Boolean, Column, ForeignKey, BigInteger, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, validates
from utils.ulid import generate_ulid
from pgvector.sqlalchemy import Vector

Base = declarative_base()

# Single source of truth for the pgvector embedding width.
# Must stay in sync with db/schema.sql `VECTOR(512)` and the
# output_dimensionality used in utils/llm.py:get_embeddings
# (primary Gemini + Voyage/Jina fallbacks are all pinned to 512 there).
EMBEDDING_DIMENSIONS = 512


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    telegram_chat_id = Column(BigInteger, unique=True, index=True, nullable=True)
    discord_channel_id = Column(BigInteger, unique=True, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    title = Column(String(255), default="New Chat")
    agent = Column(String(50), default="personal assistant", nullable=False)
    active_skill = Column(String(50), nullable=True, default=None)
    is_pinned = Column(Boolean, default=False, nullable=False)
    source = Column(String(50), default="telegram", nullable=False)



class OAuthToken(Base):
    __tablename__ = "oauth_tokens"
    # Composite PK: one Conversation holds one row per provider
    # (google + future providers). Legacy single-provider rows migrate
    # cleanly since conversation_id was already unique.
    conversation_id = Column(
        String, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    provider = Column(String, primary_key=True)
    token = Column("token_data", JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class MemoryVector(Base):
    __tablename__ = "memory_vectors"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    vector = Column("embedding", Vector(EMBEDDING_DIMENSIONS), nullable=False)
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    @validates("vector")
    def validate_vector_dimensions(self, key, value):
        if value is not None and len(value) != EMBEDDING_DIMENSIONS:
            raise ValueError(
                f"Embedding dimension mismatch: got {len(value)} dims, "
                f"expected {EMBEDDING_DIMENSIONS} (pgvector VECTOR({EMBEDDING_DIMENSIONS})). "
                "Regenerate the embedding with output_dimensionality="
                f"{EMBEDDING_DIMENSIONS} (see utils/llm.py:get_embeddings)."
            )
        return value

class Experience(Base):
    __tablename__ = "experiences"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    user_query = Column(String, nullable=False)
    agent_response = Column(String, nullable=False)
    eval_score = Column(Float, nullable=True)
    eval_reason = Column(String, nullable=True)
    consolidated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class SystemPromptFragment(Base):
    __tablename__ = "system_prompt_fragments"
    key = Column(String, primary_key=True)
    content = Column(String, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow,nullable=False)

class SkillsRegistry(Base):
    __tablename__ = "skills_registry"
    name = Column(String,primary_key=True)
    description = Column(String,nullable=False)
    enabled = Column(Boolean,default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class WebViewAutomationSession(Base):
    __tablename__ = "webview_automation_sessions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    task_description = Column(String, nullable=False)
    status = Column(String(50), default="running")  # running, completed, failed, timeout
    is_success = Column(Boolean, nullable=True)
    eval_score = Column(Float, nullable=True)
    eval_reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class WebViewAutomationStep(Base):
    __tablename__ = "webview_automation_steps"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("webview_automation_sessions.id", ondelete="CASCADE"), index=True)
    step_number = Column(Integer, nullable=False)
    page_url = Column(String, nullable=True)
    dom_snapshot = Column(JSON, nullable=True)  # Minified DOM
    agent_thoughts = Column(String, nullable=True)
    action = Column(String(50), nullable=False)
    target = Column(String, nullable=True)
    value = Column(String, nullable=True)
    status = Column(String(20), nullable=False)  # success, error, timeout
    observation = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ToolInvocation(Base):
    __tablename__ = "tool_invocations"

    request_id = Column(String(50), primary_key=True)
    tool_name = Column(String(100), nullable=False)
    status = Column(String(50), nullable=False)
    result = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SyncMessage(Base):
    __tablename__ = "sync_messages"

    id = Column(String(50), primary_key=True) # ULID
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=False)
    content = Column(String, nullable=False)
    provider = Column(String(50), nullable=False)
    created_at = Column(BigInteger, nullable=False)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Briefing(Base):
    __tablename__ = "briefings"

    id = Column(String(36), primary_key=True, default=lambda: generate_ulid())
    user_id = Column(String(255), nullable=True)
    date = Column(String(10), index=True, nullable=False)
    summary_text = Column(Text, nullable=True)
    sections_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CheckIn(Base):
    """Daily check-in row: mood/energy scores plus one win and one carried item.

    A second check-in on the same day replaces the first via the unique
    (conversation_id, date) constraint (same-day upsert).
    """

    __tablename__ = "check_ins"
    __table_args__ = (UniqueConstraint("conversation_id", "date", name="uq_checkins_conversation_date"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    mood = Column(Integer, nullable=False)  # 1-5
    energy = Column(Integer, nullable=False)  # 1-5
    win = Column(Text, nullable=True)
    carrying = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    source = Column(String(50), default="android_client", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


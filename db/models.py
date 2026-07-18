import uuid
from datetime import datetime
from sqlalchemy import JSON, DateTime, Integer, String, Float, Boolean, Column, ForeignKey
from sqlalchemy.orm import declarative_base
from pgvector.sqlalchemy import Vector

Base = declarative_base()


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, default=uuid.uuid4)
    telegram_chat_id = Column(Integer, unique=True, index=True, nullable=True)
    discord_channel_id = Column(Integer, unique=True, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    title = Column(String(255), default="New Chat")
    persona = Column(String(50), default="personal assistant", nullable=False)
    active_skill = Column(String(50), nullable=True, default=None)



class OAuthToken(Base):
    __tablename__ = "oauth_tokens"
    conversation_id = Column(
        String, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    token = Column("token_data", JSON, nullable=False)
    provider = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class MemoryVector(Base):
    __tablename__ = "memory_vectors"
    id = Column(String, primary_key=True, default=uuid.uuid4)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    vector = Column("embedding", Vector(512), nullable=False)
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Experience(Base):
    __tablename__ = "experiences"
    id = Column(String, primary_key=True, default=uuid.uuid4)
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
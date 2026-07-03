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
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"))
    vector = Column("embedding", Vector(512), nullable=False)
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Experience(Base):
    __tablename__ = "experiences"
    id = Column(String, primary_key=True, default=uuid.uuid4)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"))
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
import uuid
from datetime import datetime
from sqlalchemy import JSON, DateTime, Integer, String, Float, Boolean
from sqlalchemy.orm import Column, ForeignKey, declarative_base
from pgvector.sqlalchemy import Vector

Base = declarative_base()


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, default=uuid.uuid4)
    chat_id = Column(Integer, unique=True, index=True, null=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class OAuthToken(Base):
    __tablename__ = "oauth_tokens"
    conversation_id = Column(
        String, ForeignKey("conversations.id"), on_delete="CASCADE"
    )
    token = Column(JSON, null=False)
    provider = Column(String, null=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class MemoryVector(Base):
    __tablename__ = "memory_vectors"
    id = Column(String, primary_key=True, default=uuid.uuid4)
    conversation_id = Column(String, ForeignKey("conversations.id"), on_delete="CASCADE")
    vector = Column(Vector(768), null=False)
    content = Column(String, null=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Experience(Base):
    __tablename__ = "experiences"
    id = Column(String, primary_key=True, default=uuid.uuid4)
    conversation_id = Column(String, ForeignKey("conversations.id"), on_delete="CASCADE")
    user_query = Column(String, null=False)
    agent_response = Column(String, null=False)
    eval_score = Column(Float, nullable=True)
    eval_reason = Column(String, nullable=True)
    consolidated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class SystemPromptFragment(Base):
    __tablename__ = "system_prompt_fragments"
    key = Column(String, primary_key=True)
    content = Column(String, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow,null=False)

class SkillsRegistry(Base):
    __tablename__ = "skills_registry"
    name = Column(String,primary_key=True)
    description = Column(String,null=False)
    enabled = Column(Boolean,default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Column, ForeignKey, declarative_base

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

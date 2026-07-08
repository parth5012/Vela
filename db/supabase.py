import os
from utils.logger import StructuredLogger
from db.session import get_db_session
from db.client import DBClient
from supabase import create_client

class SupabaseDB:
    """Database client proxy that routes requests to SQLAlchemy to avoid DNS/HTTP API failures."""
    
    def __init__(self):
        self.logger = StructuredLogger("SupabaseDB")
        self.logger.info("Initialized SupabaseDB client wrapper using SQLAlchemy")

    def get_or_create_conversation(self, telegram_chat_id: int) -> str:
        self.logger.info("Fetching conversation via SQLAlchemy", telegram_chat_id=telegram_chat_id)
        try:
            with get_db_session() as session:
                client = DBClient(session)
                conv = client.get_or_create_conversation(telegram_chat_id)
                session.commit()
                return conv.id
        except Exception as e:
            self.logger.error("Database query failed, returning fallback mock-uuid", error=str(e), telegram_chat_id=telegram_chat_id)
            return "mock-conversation-uuid"

    def store_oauth_tokens(self, conversation_id: str, provider: str, token_data: dict):
        self.logger.info("Storing OAuth tokens via SQLAlchemy", conversation_id=conversation_id, provider=provider)
        try:
            with get_db_session() as session:
                client = DBClient(session)
                client.store_oauth_token(conversation_id, provider, token_data)
                session.commit()
            self.logger.info("Successfully saved OAuth tokens", conversation_id=conversation_id, provider=provider)
        except Exception as e:
            self.logger.error("Failed to store OAuth tokens", error=str(e), conversation_id=conversation_id, provider=provider)

    def get_oauth_tokens(self, conversation_id: str, provider: str) -> dict | None:
        self.logger.info("Retrieving OAuth tokens via SQLAlchemy", conversation_id=conversation_id, provider=provider)
        try:
            with get_db_session() as session:
                client = DBClient(session)
                token_record = client.get_oauth_token(conversation_id, provider)
                tokens = token_record.token if token_record else None
                self.logger.info("OAuth tokens query result", conversation_id=conversation_id, provider=provider, found=tokens is not None)
                return tokens
        except Exception as e:
            self.logger.error("Failed to retrieve OAuth tokens", error=str(e), conversation_id=conversation_id, provider=provider)
            return None

    def get_or_create_discord_conversation(self, discord_channel_id: int) -> str:
        self.logger.info("Fetching Discord conversation via SQLAlchemy", discord_channel_id=discord_channel_id)
        try:
            with get_db_session() as session:
                client = DBClient(session)
                conv = client.get_or_create_discord_conversation(discord_channel_id)
                session.commit()
                return conv.id
        except Exception as e:
            self.logger.error("Database query failed, returning fallback mock-uuid", error=str(e), discord_channel_id=discord_channel_id)
            return "mock-conversation-uuid"

    def save_experience(self, conversation_id: str, user_query: str, agent_response: str) -> str | None:
        self.logger.info("Saving experience via SQLAlchemy", conversation_id=conversation_id)
        try:
            with get_db_session() as session:
                client = DBClient(session)
                exp = client.save_experience(conversation_id, user_query, agent_response)
                session.commit()
                return exp.id
        except Exception as e:
            self.logger.error("Failed to save experience", error=str(e), conversation_id=conversation_id)
            return None

    def update_conversation_active_skill(self, conversation_id: str, active_skill: str | None) -> bool:
        self.logger.info("Updating active skill via SQLAlchemy", conversation_id=conversation_id, active_skill=active_skill)
        try:
            with get_db_session() as session:
                client = DBClient(session)
                conv = client.update_conversation_active_skill(conversation_id, active_skill)
                if conv:
                    session.commit()
                    return True
                return False
        except Exception as e:
            self.logger.error("Failed to update active skill", error=str(e), conversation_id=conversation_id)
            return False


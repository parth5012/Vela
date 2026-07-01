import os
from supabase import create_client, Client
from dotenv import load_dotenv
from utils.logger import StructuredLogger

load_dotenv()

class SupabaseDB:
    def __init__(self):
        self.logger = StructuredLogger("SupabaseDB")
        url = os.getenv("SUPABASE_URL", "https://mock.supabase.co")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "mock_key")
        self.client: Client = create_client(url, key)
        self.logger.info("Initialized SupabaseDB client")

    def get_or_create_conversation(self, telegram_chat_id: int) -> str:
        self.logger.info("Fetching conversation", telegram_chat_id=telegram_chat_id)
        try:
            res = self.client.table("conversations").select("id").eq("telegram_chat_id", telegram_chat_id).execute()
            if res.data:
                conv_id = res.data[0]["id"]
                self.logger.info("Found existing conversation", telegram_chat_id=telegram_chat_id, conversation_id=conv_id)
                return conv_id
            
            insert_res = self.client.table("conversations").insert({"telegram_chat_id": telegram_chat_id}).execute()
            conv_id = insert_res.data[0]["id"]
            self.logger.info("Created new conversation record", telegram_chat_id=telegram_chat_id, conversation_id=conv_id)
            return conv_id
        except Exception as e:
            self.logger.error("Database query failed, returning fallback mock-uuid", error=str(e), telegram_chat_id=telegram_chat_id)
            return "mock-conversation-uuid"

    def store_oauth_tokens(self, conversation_id: str, provider: str, token_data: dict):
        self.logger.info("Storing OAuth tokens", conversation_id=conversation_id, provider=provider)
        try:
            self.client.table("oauth_tokens").upsert({
                "conversation_id": conversation_id,
                "provider": provider,
                "token_data": token_data
            }).execute()
            self.logger.info("Successfully saved OAuth tokens", conversation_id=conversation_id, provider=provider)
        except Exception as e:
            self.logger.error("Failed to store OAuth tokens", error=str(e), conversation_id=conversation_id, provider=provider)

    def get_oauth_tokens(self, conversation_id: str, provider: str) -> dict | None:
        self.logger.info("Retrieving OAuth tokens", conversation_id=conversation_id, provider=provider)
        try:
            res = self.client.table("oauth_tokens").select("token_data").eq("conversation_id", conversation_id).eq("provider", provider).execute()
            tokens = res.data[0]["token_data"] if res.data else None
            self.logger.info("OAuth tokens query result", conversation_id=conversation_id, provider=provider, found=tokens is not None)
            return tokens
        except Exception as e:
            self.logger.error("Failed to retrieve OAuth tokens", error=str(e), conversation_id=conversation_id, provider=provider)
            return None

    def get_or_create_discord_conversation(self, discord_channel_id: int) -> str:
        self.logger.info("Fetching Discord conversation", discord_channel_id=discord_channel_id)
        try:
            res = self.client.table("conversations").select("id").eq("discord_channel_id", discord_channel_id).execute()
            if res.data:
                conv_id = res.data[0]["id"]
                self.logger.info("Found existing Discord conversation", discord_channel_id=discord_channel_id, conversation_id=conv_id)
                return conv_id
            
            insert_res = self.client.table("conversations").insert({"discord_channel_id": discord_channel_id}).execute()
            conv_id = insert_res.data[0]["id"]
            self.logger.info("Created new Discord conversation record", discord_channel_id=discord_channel_id, conversation_id=conv_id)
            return conv_id
        except Exception as e:
            self.logger.error("Database query failed, returning fallback mock-uuid", error=str(e), discord_channel_id=discord_channel_id)
            return "mock-conversation-uuid"


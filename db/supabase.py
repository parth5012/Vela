import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

class SupabaseDB:
    def __init__(self):
        url = os.getenv("SUPABASE_URL", "https://mock.supabase.co")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "mock_key")
        self.client: Client = create_client(url, key)

    def get_or_create_conversation(self, telegram_chat_id: int) -> str:
        try:
            res = self.client.table("conversations").select("id").eq("telegram_chat_id", telegram_chat_id).execute()
            if res.data:
                return res.data[0]["id"]
            
            insert_res = self.client.table("conversations").insert({"telegram_chat_id": telegram_chat_id}).execute()
            return insert_res.data[0]["id"]
        except Exception as e:
            # Fallback for testing/offline scenarios
            return "mock-conversation-uuid"

    def store_oauth_tokens(self, conversation_id: str, provider: str, token_data: dict):
        self.client.table("oauth_tokens").upsert({
            "conversation_id": conversation_id,
            "provider": provider,
            "token_data": token_data
        }).execute()

    def get_oauth_tokens(self, conversation_id: str, provider: str) -> dict | None:
        res = self.client.table("oauth_tokens").select("token_data").eq("conversation_id", conversation_id).eq("provider", provider).execute()
        return res.data[0]["token_data"] if res.data else None

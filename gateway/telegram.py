from telegram import Update, Bot
from langchain_core.messages import HumanMessage
from agent.graph import graph
from utils.logger import StructuredLogger
from db.supabase import SupabaseDB
import os

class TelegramGateway:
    def __init__(self, db: SupabaseDB):
        self.logger = StructuredLogger("TelegramGateway")
        self.db = db
        token = os.getenv("TELEGRAM_BOT_TOKEN", "mock_token")
        self.bot = Bot(token=token)
        self.logger.info("Initialized TelegramGateway with bot client")

    async def handle_update(self, payload: dict) -> str:
        self.logger.info("Received update webhook payload", payload=payload)
        try:
            update = Update.de_json(payload, self.bot)
            if not update or not update.effective_chat or not update.effective_message:
                self.logger.warning("Ignored webhook update: missing chat or message payload structure")
                return "Ignored update: missing chat or message"
                
            chat_id = update.effective_chat.id
            message_text = update.effective_message.text
            if not message_text:
                self.logger.warning("Ignored webhook update: empty message content", chat_id=chat_id)
                return "Ignored empty message"
                
            self.logger.info("Processing user message", chat_id=chat_id, message_length=len(message_text))
            
            # Fetch the actual conversation UUID from DB
            conv_id = self.db.get_or_create_conversation(chat_id)
            
            # Run the LangGraph supervisor graph
            inputs = {
                "messages": [HumanMessage(content=message_text)],
                "telegram_chat_id": chat_id,
                "db_conv_id": conv_id,
                "relevant_memories": [],
                "next_node": ""
            }
            
            self.logger.info("Invoking LangGraph supervisor graph", chat_id=chat_id)
            res = graph.invoke(inputs)
            
            # The supervisor reply is the last message in the list
            assistant_reply = "I couldn't process that request."
            if res.get("messages"):
                assistant_reply = res["messages"][-1].content
                
            self.logger.info("Supervisor graph execution completed", chat_id=chat_id, reply_length=len(assistant_reply))
            
            # Send message back to user via Telegram Bot API
            self.logger.info("Sending message back to Telegram user", chat_id=chat_id)
            await self.bot.send_message(chat_id=chat_id, text=assistant_reply)
            self.logger.info("Successfully sent reply to Telegram", chat_id=chat_id)
            return f"Processed and replied: '{assistant_reply}'"
        except Exception as e:
            self.logger.error("Error processing update webhook", error=str(e))
            return f"Error: {str(e)}"

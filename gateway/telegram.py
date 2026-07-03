from telegram import Update, Bot
from langchain_core.messages import HumanMessage, AIMessage, ToolCall
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
            
            self.logger.info("Streaming LangGraph supervisor graph", chat_id=chat_id)
            
            sent_replies = []
            async for chunk in graph.astream(inputs, stream_mode="updates"):
                for node_name, node_output in chunk.items():
                    if node_name == "chatbot" and "messages" in node_output:
                        for msg in node_output["messages"]:
                            if isinstance(msg, AIMessage) and msg.content.strip():
                                self.logger.info("Sending streamed AI message to Telegram", chat_id=chat_id)
                                await self.bot.send_message(chat_id=chat_id, text=msg.content)
                                sent_replies.append(msg.content)
                            elif isinstance(msg, ToolCall) and msg.content.strip():
                                self.logger.info("Sending streamed tool call message to Telegram", chat_id=chat_id)
                                await self.bot.send_message(chat_id=chat_id, text=f'> _{msg.content}_')
                                sent_replies.append(msg.content)
                                
            if not sent_replies:
                # Fallback if chatbot didn't emit any messages
                assistant_reply = "I couldn't process that request."
                await self.bot.send_message(chat_id=chat_id, text=assistant_reply)
                sent_replies.append(assistant_reply)
                
            self.logger.info("Supervisor graph execution completed", chat_id=chat_id, num_replies=len(sent_replies))
            return f"Processed and replied: '{sent_replies[-1]}'"
        except Exception as e:
            self.logger.error("Error processing update webhook", error=str(e))
            return f"Error: {str(e)}"

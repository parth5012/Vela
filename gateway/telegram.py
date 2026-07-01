from telegram import Update, Bot
from langchain_core.messages import HumanMessage
from agent.graph import graph
import os

class TelegramGateway:
    def __init__(self):
        token = os.getenv("TELEGRAM_BOT_TOKEN", "mock_token")
        self.bot = Bot(token=token)

    async def handle_update(self, payload: dict) -> str:
        try:
            update = Update.de_json(payload, self.bot)
            if not update or not update.effective_chat or not update.effective_message:
                return "Ignored update: missing chat or message"
                
            chat_id = update.effective_chat.id
            message_text = update.effective_message.text
            if not message_text:
                return "Ignored empty message"
                
            # Run the LangGraph supervisor graph
            inputs = {
                "messages": [HumanMessage(content=message_text)],
                "telegram_chat_id": chat_id,
                "db_conv_id": "conv-123",
                "relevant_memories": [],
                "next_node": ""
            }
            res = graph.invoke(inputs)
            
            # The supervisor reply is the last message in the list
            assistant_reply = "I couldn't process that request."
            if res.get("messages"):
                assistant_reply = res["messages"][-1].content
                
            # Send message back to user via Telegram Bot API
            await self.bot.send_message(chat_id=chat_id, text=assistant_reply)
            return f"Processed and replied: '{assistant_reply}'"
        except Exception as e:
            return f"Error: {str(e)}"


from telegram import Update, Bot
import os

class TelegramGateway:
    def __init__(self):
        token = os.getenv("TELEGRAM_BOT_TOKEN", "mock_token")
        self.bot = Bot(token=token)

    async def handle_update(self, payload: dict) -> str:
        try:
            update = Update.de_json(payload, self.bot)
            chat_id = update.effective_chat.id
            message_text = update.effective_message.text
            return f"Received message '{message_text}' from chat {chat_id}"
        except Exception as e:
            return f"Error: {str(e)}"

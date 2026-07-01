import discord
import os
import asyncio
from langchain_core.messages import HumanMessage
from agent.graph import graph
from utils.logger import StructuredLogger
from db.supabase import SupabaseDB

class DiscordGateway:
    def __init__(self, db: SupabaseDB):
        self.logger = StructuredLogger("DiscordGateway")
        self.db = db
        intents = discord.Intents.default()
        intents.message_content = True
        intents.messages = True
        self.client = discord.Client(intents=intents)
        self._register_handlers()

    def _register_handlers(self):
        @self.client.event
        async def on_ready():
            self.logger.info("Discord Bot connected", bot_user=str(self.client.user))

        @self.client.event
        async def on_message(message: discord.Message):
            # Check if bot message or message from self
            if message.author == self.client.user or (hasattr(message.author, "bot") and message.author.bot):
                return

            self.logger.info("Received Discord message", channel_id=message.channel.id, author=str(message.author))
            
            try:
                conv_id = self.db.get_or_create_discord_conversation(message.channel.id)
                
                inputs = {
                    "messages": [HumanMessage(content=message.content)],
                    "telegram_chat_id": 0,
                    "db_conv_id": conv_id,
                    "relevant_memories": [],
                    "next_node": ""
                }
                
                async with message.channel.typing():
                    res = await asyncio.to_thread(graph.invoke, inputs)
                
                assistant_reply = "I couldn't process that request."
                if res.get("messages"):
                    assistant_reply = res["messages"][-1].content
                
                await message.channel.send(assistant_reply)
                self.logger.info("Sent reply to Discord", channel_id=message.channel.id)
            except Exception as e:
                self.logger.error("Error handling Discord message", error=str(e))

    async def start(self):
        token = os.getenv("DISCORD_BOT_TOKEN")
        if not token or token == "your_discord_bot_token" or token == "mock_token":
            self.logger.warning("DISCORD_BOT_TOKEN is not set or is mock. Discord gateway will not start.")
            return
        self.logger.info("Starting Discord bot client...")
        await self.client.start(token)

    async def close(self):
        self.logger.info("Closing Discord bot client...")
        await self.client.close()

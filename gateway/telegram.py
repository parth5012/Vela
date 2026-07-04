from sqlalchemy.sql.operators import startswith_op
from telegram import Update, Bot
from collections import deque
from langchain_core.messages import HumanMessage, AIMessage, ToolCall
from agent.graph import graph
from utils.logger import StructuredLogger
from db.supabase import SupabaseDB
import os
import asyncio

def _get_message_text(content) -> str:
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        text_parts = []
        for part in content:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                if "text" in part:
                    text_parts.append(part["text"])
        return "".join(text_parts)
    elif content is None:
        return ""
    else:
        return str(content)

class TelegramGateway:
    def __init__(self, db: SupabaseDB):
        self.logger = StructuredLogger("TelegramGateway")
        self.db = db
        token = os.getenv("TELEGRAM_BOT_TOKEN", "mock_token")
        self.bot = Bot(token=token)
        self.processed_updates = set()
        self.update_history = deque(maxlen=1000)
        self.logger.info("Initialized TelegramGateway with bot client")

    async def handle_update(self, payload: dict) -> str:
        self.logger.info("Received update webhook payload", payload=payload)
        
        # Deduplicate incoming webhook updates from Telegram
        update_id = payload.get("update_id")
        if update_id is not None:
            if update_id in self.processed_updates:
                self.logger.warning("Ignored duplicate webhook update", update_id=update_id)
                return f"Ignored duplicate update {update_id}"
            self.processed_updates.add(update_id)
            self.update_history.append(update_id)
            if len(self.update_history) >= 1000:
                self.processed_updates = set(self.update_history)

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
            
            # Fetch the actual conversation UUID from DB (in a thread pool to keep the event loop non-blocking)
            conv_id = await asyncio.to_thread(self.db.get_or_create_conversation, chat_id)
            
            # Run the LangGraph supervisor graph
            inputs = {
                "messages": [HumanMessage(content=message_text)],
                "telegram_chat_id": chat_id,
                "db_conv_id": conv_id,
                "relevant_memories": [],
                "next_node": ""
            }
            
            # Run graph execution (Toggle between streaming and invoking below)
            # sent_replies = await self._run_streaming(chat_id, inputs)
            sent_replies = await self._run_invoking(chat_id, inputs)
                                
            if not sent_replies or sent_replies[-1].strip().startswith("Error invoking LLM"):
                # Fallback if chatbot didn't emit any messages
                assistant_reply = "I couldn't process that request."
                try:
                    await self.bot.send_message(chat_id=chat_id, text=assistant_reply)
                    sent_replies.append(assistant_reply)
                except Exception as send_err:
                    self.logger.error("Failed to send fallback message to Telegram", error=str(send_err))
                    sent_replies.append(assistant_reply)

            # Store the interaction response in database (in a thread pool to keep the event loop non-blocking)
            if sent_replies:
                combined_response = "\n".join(sent_replies)
                await asyncio.to_thread(
                    self.db.save_experience,
                    conversation_id=conv_id,
                    user_query=message_text,
                    agent_response=combined_response
                )
                
            self.logger.info("Supervisor graph execution completed", chat_id=chat_id, num_replies=len(sent_replies))
            return f"Processed and replied: '{sent_replies[-1]}'"
        except (asyncio.CancelledError, GeneratorExit) as cancel_err:
            self.logger.info("Telegram update task aborted due to shutdown or disconnection", error=type(cancel_err).__name__)
            return "Cancelled"
        except Exception as e:
            self.logger.error("Error processing update webhook", error=str(e))
            return f"Error: {str(e)}"

    async def _run_streaming(self, chat_id: int, inputs: dict) -> list[str]:
        sent_replies = []
        try:
            async for chunk in graph.astream(inputs, stream_mode="updates"):
                for node_name, node_output in chunk.items():
                    if node_name == "chatbot" and "messages" in node_output:
                        for msg in node_output["messages"]:
                            msg_text = _get_message_text(msg.content)
                            if isinstance(msg, AIMessage) and msg_text.strip():
                                self.logger.info("Sending streamed AI message to Telegram", chat_id=chat_id)
                                try:
                                    await self.bot.send_message(chat_id=chat_id, text=msg_text)
                                    sent_replies.append(msg_text)
                                except Exception as send_err:
                                    self.logger.error("Failed to send intermediate message to Telegram", error=str(send_err))
                            elif isinstance(msg, ToolCall) and msg_text.strip():
                                self.logger.info("Sending streamed tool call message to Telegram", chat_id=chat_id)
                                try:
                                    await self.bot.send_message(chat_id=chat_id, text=f'> _{msg_text}_')
                                    sent_replies.append(msg_text)
                                except Exception as send_err:
                                    self.logger.error("Failed to send tool call message to Telegram", error=str(send_err))
        except (asyncio.CancelledError, GeneratorExit) as cancel_err:
            self.logger.info("Graph streaming task cancelled or closed gracefully", chat_id=chat_id, error=type(cancel_err).__name__)
            raise
        return sent_replies

    async def _run_invoking(self, chat_id: int, inputs: dict) -> list[str]:
        self.logger.info("Invoking LangGraph supervisor graph (non-streaming)", chat_id=chat_id)
        sent_replies = []
        try:
            res = await graph.ainvoke(inputs)
            if "messages" in res:
                # Send new messages generated during the graph execution
                new_messages = res["messages"][len(inputs["messages"]):]
                for msg in new_messages:
                    msg_text = _get_message_text(msg.content)
                    if isinstance(msg, AIMessage) and msg_text.strip():
                        self.logger.info("Sending final AI message to Telegram", chat_id=chat_id)
                        await self.bot.send_message(chat_id=chat_id, text=msg_text)
                        sent_replies.append(msg_text)
        except (asyncio.CancelledError, GeneratorExit) as cancel_err:
            self.logger.info("Graph invoking task cancelled or closed gracefully", chat_id=chat_id, error=type(cancel_err).__name__)
            raise
        return sent_replies

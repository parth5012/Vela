import os
import uuid
import httpx
import asyncio
from datetime import datetime
from langchain_core.messages import HumanMessage
from agent.graph import graph
from utils.logger import StructuredLogger
from db.supabase import SupabaseDB
from utils.google_drive import get_google_credentials, upload_to_google_drive

class CarbonVoiceGateway:
    """
    Gateway to handle incoming voice transcription messages from Carbon Voice,
    save the audio-text pairs to the user's Google Drive, and run the LangGraph supervisor.
    """
    def __init__(self, db: SupabaseDB):
        self.logger = StructuredLogger("CarbonVoiceGateway")
        self.db = db

    async def handle_webhook(
        self,
        payload: dict,
        audio_file_bytes: bytes | None = None,
        audio_filename: str | None = None,
        audio_mime_type: str | None = None
    ) -> dict:
        """
        Processes a webhook from Carbon Voice:
        1. Extracts transcription and conversation context.
        2. Retrieves audio (either from file bytes or downloading from audio_url).
        3. Saves the audio-text pair to Google Drive if credentials exist.
        4. Runs the supervisor LangGraph agent and returns the response.
        """
        self.logger.info("Handling Carbon Voice webhook request", payload=payload)

        # 1. Extract transcription text
        # Accept 'transcript', 'text', 'message', or 'notes' fields
        message_text = (
            payload.get("transcript") or 
            payload.get("text") or 
            payload.get("message") or 
            payload.get("notes") or 
            ""
        ).strip()

        # 2. Extract conversation ID or Telegram/Discord mapping
        # Try to resolve to a conversation_id
        raw_conv_id = (
            payload.get("conversation_id") or 
            payload.get("chat_id") or 
            payload.get("channel_id") or 
            payload.get("user_id")
        )

        if not raw_conv_id:
            # Fall back to a default conversation or generate a deterministic one
            raw_conv_id = "carbonvoice-default-thread"
            self.logger.warning("No conversation ID provided in payload. Using fallback ID", fallback_id=raw_conv_id)

        # Retrieve/create conversation from database
        try:
            # If the ID looks like an integer, treat it as telegram_chat_id
            if isinstance(raw_conv_id, int) or (isinstance(raw_conv_id, str) and raw_conv_id.isdigit()):
                conv_id = await asyncio.to_thread(self.db.get_or_create_conversation, int(raw_conv_id))
            else:
                # String ID, normalize to UUID using the existing db/client logic (via FastAPI normalize_thread_id)
                # For gateway level, we can query or create conversation using supabase client
                # Let's get or create via supabase client or direct mock.
                # In main.py, we have normalize_thread_id which creates deterministic UUID.
                # Let's do that:
                from agent.main import normalize_thread_id
                conv_id = normalize_thread_id(str(raw_conv_id))
                
                # Check if conversation exists, if not create it
                from db.session import get_db_session
                from db.client import DBClient
                from db.models import Conversation
                
                with get_db_session() as session:
                    client = DBClient(session)
                    conv = session.query(Conversation).filter_by(id=conv_id).first()
                    if not conv:
                        client.create_client_conversation(persona="personal assistant", conversation_id=conv_id)
                        session.commit()
                        self.logger.info("Created new conversation thread for Carbon Voice", conv_id=conv_id)
        except Exception as db_err:
            self.logger.error("Database resolution failed for conversation, using fallback", error=str(db_err))
            conv_id = str(uuid.uuid4())

        # 3. Retrieve Audio Bytes
        audio_bytes = audio_file_bytes
        audio_url = payload.get("audio_url")
        
        # Deduce filename and mime-type
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:6]
        
        if not audio_filename:
            audio_filename = f"audio_{timestamp}_{unique_id}.wav"
        if not audio_mime_type:
            audio_mime_type = "audio/wav"

        # If audio is not directly sent but a URL is provided, download it
        if not audio_bytes and audio_url:
            self.logger.info("Downloading audio from URL", audio_url=audio_url)
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(audio_url, timeout=15.0)
                    if response.status_code == 200:
                        audio_bytes = response.content
                        self.logger.info("Successfully downloaded audio from URL")
                        # Try to get extension from URL or content-type
                        content_type = response.headers.get("content-type")
                        if content_type:
                            audio_mime_type = content_type
                            if "mpeg" in content_type:
                                audio_filename = f"audio_{timestamp}_{unique_id}.mp3"
                            elif "wav" in content_type:
                                audio_filename = f"audio_{timestamp}_{unique_id}.wav"
                    else:
                        self.logger.warning("Failed to download audio", status_code=response.status_code)
            except Exception as dl_err:
                self.logger.error("Error downloading audio from URL", error=str(dl_err))

        # 4. Save Audio-Text Dataset Pairs to Google Drive
        drive_audio_file_id = None
        drive_text_file_id = None

        if message_text or audio_bytes:
            # Check Google credentials
            creds = get_google_credentials(conv_id, self.db)
            if creds:
                self.logger.info("Google credentials found. Proceeding with Google Drive dataset collection.")
                
                # Upload Audio
                if audio_bytes:
                    drive_audio_file_id = upload_to_google_drive(
                        credentials=creds,
                        file_name=audio_filename,
                        file_bytes=audio_bytes,
                        mime_type=audio_mime_type
                    )
                
                # Upload matching Transcription Text
                if message_text:
                    text_filename = f"transcript_{timestamp}_{unique_id}.txt"
                    text_bytes = message_text.encode("utf-8")
                    drive_text_file_id = upload_to_google_drive(
                        credentials=creds,
                        file_name=text_filename,
                        file_bytes=text_bytes,
                        mime_type="text/plain"
                    )
            else:
                self.logger.info("No Google credentials available for this conversation. Skipping dataset upload.")

        # 5. Run supervisor LangGraph assistant graph
        assistant_reply = "No response generated by assistant."
        if message_text:
            self.logger.info("Invoking supervisor graph", conv_id=conv_id)
            inputs = {
                "messages": [HumanMessage(content=message_text)],
                "telegram_chat_id": 0,
                "db_conv_id": conv_id,
                "relevant_memories": [],
                "next_node": "supervisor",
                "persona": "personal assistant"
            }
            try:
                # Use thread pool to run synchronous graph invoke safely in async context
                res = await asyncio.to_thread(graph.invoke, inputs)
                if res and res.get("messages"):
                    assistant_reply = res["messages"][-1].content
            except Exception as graph_err:
                self.logger.error("Error executing supervisor graph", error=str(graph_err))
                assistant_reply = f"Error processing request: {str(graph_err)}"
        else:
            self.logger.warning("Empty transcription received, skipping supervisor invocation.")
            assistant_reply = "Received empty audio/transcription."

        # Return results to webhook client
        return {
            "status": "success",
            "conversation_id": conv_id,
            "transcription": message_text,
            "assistant_response": assistant_reply,
            "dataset_collection": {
                "saved_to_drive": drive_audio_file_id is not None or drive_text_file_id is not None,
                "drive_audio_file_id": drive_audio_file_id,
                "drive_text_file_id": drive_text_file_id
            }
        }

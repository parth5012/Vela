import os
import httpx
from langchain_core.tools import tool
from utils.logger import StructuredLogger

logger = StructuredLogger("status_update_tool")

@tool
def send_status_message(chat_id: int, message: str) -> str:
    """Sends an intermediate status update or message directly to the Telegram user.
    
    Use this tool when:
    - You are executing a long-running calculation or search and want to keep the user informed.
    - You want to notify the user of progress before starting another time-consuming tool.
    
    Args:
        chat_id: The Telegram chat ID of the user (found in your Metadata as Telegram Chat ID).
        message: The status or update message content to send.
        
    Returns:
        A confirmation string stating whether the message was sent successfully.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN", "mock_token")
    if not token or token == "mock_token":
        logger.info("Mock sending status message", chat_id=chat_id, status_text=message)
        return f"Mock status message sent: '{message}' to chat_id: {chat_id}"
        
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        payload = {
            "chat_id": chat_id,
            "text": message
        }
        res = httpx.post(url, json=payload, timeout=10.0)
        res.raise_for_status()
        logger.info("Successfully sent status message", chat_id=chat_id, status_text=message)
        return f"Status message sent successfully to user: '{message}'"
    except Exception as e:
        logger.error("Failed to send status message", chat_id=chat_id, error=str(e))
        return f"Failed to send status message: {str(e)}"

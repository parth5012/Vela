"""Because of Telegram Bot API limitations, bots are not
  allowed to retrieve past message history (they only
  receive messages in real-time via webhooks/polling when
  active).

  To solve this, I've created a CLI helper script so you
  don't have to write any SQL or manually insert anything.

  ### How to Import Your History

  1. Put your previous chats in a JSON file (e.g.
  previous_chats.json ) with this format:

    [
      {
        "query": "What is the capital of France?",
        "response": "The capital of France is Paris."
      },
      {
        "query": "Thanks!",
        "response": "You're welcome!"
      }
    ]

  2. Run the import script import_history.py in your terminal:

    python scratch/import_history.py <your_telegram_chat_id>
  previous_chats.json"""


import sys
import os
import json

# Add parent directory to path so python can locate db package
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from db.session import get_db_session
from db.supabase import SupabaseDB
from db.client import DBClient

def import_history(telegram_chat_id: int, history_filepath: str):
    db = SupabaseDB()
    
    # 1. Resolve the database conversation ID
    conv_id = db.get_or_create_conversation(telegram_chat_id)
    if conv_id == "mock-conversation-uuid":
        print("Error: Could not retrieve or create conversation in database. Please check your DB connection.")
        return

    if not os.path.exists(history_filepath):
        print(f"Error: History file '{history_filepath}' not found.")
        return

    try:
        with open(history_filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        if not isinstance(data, list):
            print("Error: JSON file must contain a list of objects.")
            return
            
        with get_db_session() as session:
            client = DBClient(session)
            imported_count = 0
            
            for item in data:
                query = item.get("query") or item.get("user_query")
                response = item.get("response") or item.get("agent_response")
                
                if query and response:
                    client.save_experience(
                        conversation_id=conv_id,
                        user_query=query,
                        agent_response=response
                    )
                    imported_count += 1
            
            session.commit()
            print(f"Successfully imported {imported_count} chat history records to conversation {conv_id} (Telegram ID: {telegram_chat_id})")
            
    except Exception as e:
        print(f"Failed to import history: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python scratch/import_history.py <telegram_chat_id> <path_to_json_file>")
        print("Example JSON format:\n[\n  {\"query\": \"hello there\", \"response\": \"hi! how can I help you today?\"}\n]")
    else:
        try:
            chat_id = int(sys.argv[1])
            filepath = sys.argv[2]
            import_history(chat_id, filepath)
        except ValueError:
            print("Error: <telegram_chat_id> must be an integer.")

import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from db.session import get_db_session
from db.models import Conversation, MemoryVector

try:
    with get_db_session() as session:
        convs = session.query(Conversation).all()
        print(f"Total Conversations: {len(convs)}")
        for c in convs:
            print(f" - Conv ID: {c.id}, Telegram ID: {c.telegram_chat_id}")
            
        mems = session.query(MemoryVector).all()
        print(f"\nTotal Memory Vectors: {len(mems)}")
        for m in mems:
            print(f" - Memory ID: {m.id}, Conv ID: {m.conversation_id}, Content: {m.content}")
            
except Exception as e:
    print(f"Error querying database: {e}")

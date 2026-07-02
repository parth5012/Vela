import uuid
from sqlalchemy.orm import Session
from db.models import Conversation, OAuthToken, MemoryVector, Experience, SystemPromptFragment, SkillsRegistry
from datetime import datetime

class DBClient:
    def __init__(self, session: Session):
        self.session = session

    def get_or_create_conversation(self, telegram_chat_id: int) -> Conversation:
        conv = self.session.query(Conversation).filter_by(chat_id=telegram_chat_id).first()
        if not conv:
            # Generate string UUID for id
            conv_id = str(uuid.uuid4())
            conv = Conversation(id=conv_id, chat_id=telegram_chat_id)
            self.session.add(conv)
            self.session.flush()
        return conv

    def get_or_create_discord_conversation(self, discord_channel_id: int) -> Conversation:
        conv = self.session.query(Conversation).filter_by(chat_id=discord_channel_id).first()
        if not conv:
            conv_id = str(uuid.uuid4())
            conv = Conversation(id=conv_id, chat_id=discord_channel_id)
            self.session.add(conv)
            self.session.flush()
        return conv

    def store_oauth_token(self, conversation_id: str, provider: str, token_data: dict) -> OAuthToken:
        token = self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()
        if token:
            token.token = token_data
            token.updated_at = datetime.utcnow()
        else:
            token = OAuthToken(conversation_id=conversation_id, provider=provider, token=token_data)
            self.session.add(token)
        self.session.flush()
        return token

    def get_oauth_token(self, conversation_id: str, provider: str) -> OAuthToken | None:
        return self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()

    def save_memory_vector(self, conversation_id: str, content: str, embedding_vector: list[float]) -> MemoryVector:
        vector_id = str(uuid.uuid4())
        vector = MemoryVector(id=vector_id, conversation_id=conversation_id, content=content, vector=embedding_vector)
        self.session.add(vector)
        self.session.flush()
        return vector

    def save_experience(self, conversation_id: str, user_query: str, agent_response: str, eval_score: float = None, eval_reason: str = None) -> Experience:
        exp_id = str(uuid.uuid4())
        exp = Experience(
            id=exp_id,
            conversation_id=conversation_id,
            user_query=user_query,
            agent_response=agent_response,
            eval_score=eval_score,
            eval_reason=eval_reason
        )
        self.session.add(exp)
        self.session.flush()
        return exp

    def get_unconsolidated_experiences(self) -> list[Experience]:
        return self.session.query(Experience).filter_by(consolidated=False).all()

    def update_prompt_fragment(self, key: str, content: str) -> SystemPromptFragment:
        frag = self.session.query(SystemPromptFragment).filter_by(key=key).first()
        if frag:
            frag.content = content
            frag.updated_at = datetime.utcnow()
        else:
            frag = SystemPromptFragment(key=key, content=content)
            self.session.add(frag)
        self.session.flush()
        return frag

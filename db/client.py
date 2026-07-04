import uuid
from sqlalchemy.orm import Session
from db.models import Conversation, OAuthToken, MemoryVector, Experience, SystemPromptFragment, SkillsRegistry
from datetime import datetime, UTC

class DBClient:
    """Wrapper database client offering standard CRUD queries using SQLAlchemy session scopes.
    
    Provides convenient abstractions for managing conversations, oauth credentials,
    semantic memories, evaluation logs (experiences), and prompt fragments.
    """
    
    def __init__(self, session: Session):
        """Initializes the DBClient with an active SQLAlchemy Session.
        
        Args:
            session: An active SQLAlchemy Session context manager.
        """
        self.session = session

    def get_or_create_conversation(self, telegram_chat_id: int) -> Conversation:
        """Retrieves or creates a Telegram conversation registry.
        
        Args:
            telegram_chat_id: The unique identifier of the Telegram chat.
            
        Returns:
            The Conversation declarative model instance.
        """
        conv = self.session.query(Conversation).filter_by(telegram_chat_id=telegram_chat_id).first()
        if not conv:
            conv_id = str(uuid.uuid4())
            conv = Conversation(id=conv_id, telegram_chat_id=telegram_chat_id)
            self.session.add(conv)
            self.session.flush()
        return conv

    def get_or_create_discord_conversation(self, discord_channel_id: int) -> Conversation:
        """Retrieves or creates a Discord conversation registry.
        
        Args:
            discord_channel_id: The unique identifier of the Discord channel.
            
        Returns:
            The Conversation declarative model instance.
        """
        conv = self.session.query(Conversation).filter_by(discord_channel_id=discord_channel_id).first()
        if not conv:
            conv_id = str(uuid.uuid4())
            conv = Conversation(id=conv_id, discord_channel_id=discord_channel_id)
            self.session.add(conv)
            self.session.flush()
        return conv

    def store_oauth_token(self, conversation_id: str, provider: str, token_data: dict) -> OAuthToken:
        """Saves or updates OAuth credentials for a specific provider in a conversation.
        
        Args:
            conversation_id: The UUID representing the conversation.
            provider: The OAuth provider name (e.g. 'google').
            token_data: A dictionary containing access/refresh tokens.
            
        Returns:
            The stored OAuthToken instance.
        """
        token = self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()
        if token:
            token.token = token_data
            token.updated_at = datetime.now(UTC).replace(tzinfo=None)
        else:
            token = OAuthToken(conversation_id=conversation_id, provider=provider, token=token_data)
            self.session.add(token)
        self.session.flush()
        return token

    def get_oauth_token(self, conversation_id: str, provider: str) -> OAuthToken | None:
        """Fetches the OAuth token for a specific conversation and provider.
        
        Args:
            conversation_id: The UUID representing the conversation.
            provider: The OAuth provider name.
            
        Returns:
            The OAuthToken model instance or None if not found.
        """
        return self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()

    def save_memory_vector(self, conversation_id: str, content: str, embedding_vector: list[float]) -> MemoryVector:
        """Saves an unstructured text memory and its vector embedding to pgvector.
        
        Args:
            conversation_id: The UUID representing the conversation.
            content: The text content of the memory fragment.
            embedding_vector: The list of float embeddings.
            
        Returns:
            The created MemoryVector instance.
        """
        vector_id = str(uuid.uuid4())
        vector = MemoryVector(id=vector_id, conversation_id=conversation_id, content=content, vector=embedding_vector)
        self.session.add(vector)
        self.session.flush()
        return vector

    def save_experience(self, conversation_id: str, user_query: str, agent_response: str, eval_score: float = None, eval_reason: str = None) -> Experience:
        """Saves an interaction log (experience) to the database for evaluation and consolidation.
        
        Args:
            conversation_id: The UUID representing the conversation.
            user_query: The user's input text message.
            agent_response: The assistant's reply text.
            eval_score: An optional evaluation score (1.0 to 5.0).
            eval_reason: An optional text reason for the score.
            
        Returns:
            The logged Experience instance.
        """
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
        """Retrieves all logged experiences that have not yet been consolidated by cron.
        
        Returns:
            A list of unconsolidated Experience records.
        """
        return self.session.query(Experience).filter_by(consolidated=False).all()

    def update_prompt_fragment(self, key: str, content: str) -> SystemPromptFragment:
        """Saves or updates a dynamic prompt fragment (like dynamic instructions or rules).
        
        Args:
            key: The unique string identifier of the fragment (e.g. 'dynamic_rules').
            content: The markdown content of the fragment.
            
        Returns:
            The saved SystemPromptFragment instance.
        """
        frag = self.session.query(SystemPromptFragment).filter_by(key=key).first()
        if frag:
            frag.content = content
            frag.updated_at = datetime.now(UTC).replace(tzinfo=None)
        else:
            frag = SystemPromptFragment(key=key, content=content)
            self.session.add(frag)
        self.session.flush()
        return frag

    def get_client_conversations(self) -> list[Conversation]:
        """Retrieves all conversations created by the mobile client (no external gateway ID)."""
        return self.session.query(Conversation).filter(
            Conversation.telegram_chat_id.is_(None),
            Conversation.discord_channel_id.is_(None)
        ).order_by(Conversation.updated_at.desc()).all()

    def create_client_conversation(self, title: str = "New Chat") -> Conversation:
        """Creates a new client conversation thread."""
        conv_id = str(uuid.uuid4())
        truncated_title = title[:255] if title is not None else None
        conv = Conversation(id=conv_id, title=truncated_title)
        self.session.add(conv)
        self.session.flush()
        return conv

    def update_conversation_title(self, conversation_id: str, title: str) -> Conversation | None:
        """Updates the title of a specific conversation."""
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            conv.title = title[:255] if title is not None else None
            conv.updated_at = datetime.now(UTC).replace(tzinfo=None)
            self.session.flush()
        return conv

    def delete_conversation(self, conversation_id: str) -> bool:
        """Deletes a conversation. Cascades to experiences and oauth_tokens automatically."""
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            self.session.delete(conv)
            self.session.flush()
            return True
        return False

    def get_conversation_history(self, conversation_id: str) -> list[Experience]:
        """Fetches all experiences associated with a conversation ordered chronologically."""
        return self.session.query(Experience).filter_by(
            conversation_id=conversation_id
        ).order_by(Experience.created_at.asc()).all()


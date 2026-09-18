import uuid
import json
from sqlalchemy.orm import Session
from db.models import Conversation, OAuthToken, MemoryVector, Experience, SystemPromptFragment, SkillsRegistry, SystemSetting, Briefing, CheckIn, EMBEDDING_DIMENSIONS, utcnow_naive
from datetime import timedelta
from utils.ulid import generate_ulid

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
            conv = Conversation(id=conv_id, telegram_chat_id=telegram_chat_id, source="telegram")
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
            conv = Conversation(id=conv_id, discord_channel_id=discord_channel_id, source="discord")
            self.session.add(conv)
            self.session.flush()
        return conv

    def store_oauth_token(self, conversation_id: str, provider: str, token_data: dict) -> OAuthToken:
        """Saves or updates OAuth credentials for a specific provider in a conversation.

        Args:
            conversation_id: UUID representing conversation.
            provider: OAuth provider name (e.g. 'google').
            token_data: dictionary containing access/refresh tokens.

        Returns:
            stored OAuthToken instance.
        """
        # Ensure conversation exists to satisfy foreign key constraints
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if not conv:
            conv = Conversation(
                id=conversation_id,
                title="Global Google Workspace Credentials" if conversation_id == "global" else "Google Workspace OAuth",
                agent="personal assistant"
            )
            self.session.add(conv)
            self.session.flush()

        token = self.session.query(OAuthToken).filter_by(conversation_id=conversation_id, provider=provider).first()
        if token:
            token.token = token_data
            token.updated_at = utcnow_naive()
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

        Raises:
            ValueError: If the embedding width != EMBEDDING_DIMENSIONS.
        """
        if len(embedding_vector) != EMBEDDING_DIMENSIONS:
            raise ValueError(
                f"Embedding dimension mismatch: got {len(embedding_vector)} dims, "
                f"expected {EMBEDDING_DIMENSIONS} (pgvector VECTOR({EMBEDDING_DIMENSIONS})). "
                "Regenerate the embedding with output_dimensionality="
                f"{EMBEDDING_DIMENSIONS} (see utils/llm.py:get_embeddings)."
            )
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
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            conv.updated_at = utcnow_naive()

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
            frag.updated_at = utcnow_naive()
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

    def create_client_conversation(self, title: str = "New Chat", agent: str = "personal assistant", conversation_id: str = None, source: str = "android_client") -> Conversation:
        """Creates a new client conversation thread."""
        conv_id = conversation_id or str(uuid.uuid4())
        truncated_title = title[:255] if title is not None else None
        conv = Conversation(id=conv_id, title=truncated_title, agent=agent, source=source)
        self.session.add(conv)
        self.session.flush()
        return conv

    def update_conversation_title(self, conversation_id: str, title: str) -> Conversation | None:
        """Updates the title of a specific conversation."""
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            conv.title = title[:255] if title is not None else None
            conv.updated_at = utcnow_naive()
            self.session.flush()
        return conv

    def update_conversation_active_skill(self, conversation_id: str, active_skill: str | None) -> Conversation | None:
        """Updates active skill for a specific conversation."""
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            conv.active_skill = active_skill[:50] if active_skill else None
            conv.updated_at = utcnow_naive()
            self.session.flush()
        return conv

    def get_system_setting(self, key: str) -> str | None:
        """Retrieves a system setting value by key."""
        setting = self.session.query(SystemSetting).filter_by(key=key).first()
        return setting.value if setting else None

    def set_system_setting(self, key: str, value: str) -> SystemSetting:
        """Creates or updates a system setting value."""
        setting = self.session.query(SystemSetting).filter_by(key=key).first()
        if setting:
            setting.value = value
            setting.updated_at = utcnow_naive()
        else:
            setting = SystemSetting(key=key, value=value)
            self.session.add(setting)
        self.session.flush()
        return setting

    def delete_conversation(self, conversation_id: str) -> bool:
        """Deletes a conversation. Cascades to experiences and oauth_tokens automatically."""
        conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
        if conv:
            self.session.delete(conv)
            self.session.flush()
            return True
        return False

    def get_conversation_history(self, conversation_id: str) -> list[Experience]:
        """Fetches all experiences associated with conversation ordered chronologically."""
        return self.session.query(Experience).filter_by(
            conversation_id=conversation_id
        ).order_by(Experience.created_at.asc()).all()

    def get_briefing_config(self) -> dict:
        """Retrieves briefing config with default values."""
        defaults = {
            "enabled": True,
            "time": "07:00",
            "weekdays": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            "sections": {"today": True, "inbox": True, "radar": True},
            "watch_items": [],
        }

        enabled_raw = self.get_system_setting("briefing_enabled")
        if enabled_raw is not None:
            defaults["enabled"] = enabled_raw.lower() == "true"

        time_raw = self.get_system_setting("briefing_time")
        if time_raw is not None:
            defaults["time"] = time_raw

        weekdays_raw = self.get_system_setting("briefing_weekdays")
        if weekdays_raw is not None:
            try:
                defaults["weekdays"] = json.loads(weekdays_raw)
            except Exception:
                pass

        sections_raw = self.get_system_setting("briefing_sections")
        if sections_raw is not None:
            try:
                defaults["sections"] = json.loads(sections_raw)
            except Exception:
                pass

        defaults["watch_items"] = self.get_watch_items()

        return defaults

    def update_briefing_config(self, config_data: dict) -> dict:
        """Updates system settings for briefing config."""
        if "enabled" in config_data:
            self.set_system_setting("briefing_enabled", "true" if config_data["enabled"] else "false")
        if "time" in config_data:
            self.set_system_setting("briefing_time", str(config_data["time"]))
        if "weekdays" in config_data:
            self.set_system_setting("briefing_weekdays", json.dumps(config_data["weekdays"]))
        if "sections" in config_data:
            self.set_system_setting("briefing_sections", json.dumps(config_data["sections"]))
        return self.get_briefing_config()

    def get_watch_items(self) -> list[dict]:
        """Reads briefing watch items list from system settings."""
        raw = self.get_system_setting("briefing_watch_items")
        if not raw:
            return []
        try:
            items = json.loads(raw)
            return items if isinstance(items, list) else []
        except Exception:
            return []

    def add_watch_item(self, text: str, date_hint: str | None = None) -> dict:
        """Creates a watch item dict and appends to briefing_watch_items system setting."""
        items = self.get_watch_items()
        item = {
            "id": generate_ulid(),
            "text": text,
            "date_hint": date_hint,
            "created_at": utcnow_naive().isoformat(),
        }
        items.append(item)
        self.set_system_setting("briefing_watch_items", json.dumps(items))
        return item

    def delete_watch_item(self, item_id: str) -> bool:
        """Deletes watch item by id from briefing_watch_items system setting."""
        items = self.get_watch_items()
        filtered = [i for i in items if i.get("id") != item_id]
        if len(filtered) < len(items):
            self.set_system_setting("briefing_watch_items", json.dumps(filtered))
            return True
        return False

    def save_briefing(self, date: str, summary_text: str, sections_json: dict | list, user_id: str | None = None) -> Briefing:
        """Creates and saves a Briefing record."""
        briefing = Briefing(
            id=generate_ulid(),
            user_id=user_id,
            date=date,
            summary_text=summary_text,
            sections_json=sections_json,
        )
        self.session.add(briefing)
        self.session.flush()
        return briefing

    def get_briefing_history(self, days: int = 14) -> list[Briefing]:
        """Fetches recent Briefing records."""
        query = self.session.query(Briefing)
        if days > 0:
            cutoff_date = (utcnow_naive() - timedelta(days=days)).strftime("%Y-%m-%d")
            query = query.filter(Briefing.date >= cutoff_date)
        return query.order_by(Briefing.date.desc(), Briefing.created_at.desc()).all()

    def upsert_checkin(
        self,
        conversation_id: str,
        date: str,
        mood: int,
        energy: int,
        win: str | None = None,
        carrying: str | None = None,
        note: str | None = None,
        source: str = "android_client",
    ) -> CheckIn:
        """Creates or replaces the check-in for (conversation_id, date).

        Same-day re-check-ins replace the first row instead of duplicating it.
        """
        existing = (
            self.session.query(CheckIn)
            .filter_by(conversation_id=conversation_id, date=date)
            .first()
        )
        now = utcnow_naive()
        if existing:
            existing.mood = mood
            existing.energy = energy
            existing.win = win
            existing.carrying = carrying
            existing.note = note
            existing.source = source
            existing.updated_at = now
            self.session.flush()
            return existing
        checkin = CheckIn(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            date=date,
            mood=mood,
            energy=energy,
            win=win,
            carrying=carrying,
            note=note,
            source=source,
            created_at=now,
            updated_at=now,
        )
        self.session.add(checkin)
        self.session.flush()
        return checkin

    def get_checkins(self, conversation_id: str | None = None, days: int = 14) -> list[CheckIn]:
        """Fetches recent check-ins, newest first."""
        query = self.session.query(CheckIn)
        if conversation_id:
            query = query.filter(CheckIn.conversation_id == conversation_id)
        if days > 0:
            cutoff_date = (utcnow_naive() - timedelta(days=days)).strftime("%Y-%m-%d")
            query = query.filter(CheckIn.date >= cutoff_date)
        return query.order_by(CheckIn.date.desc(), CheckIn.created_at.desc()).all()


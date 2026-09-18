"""
Manual database migration runner for Vela backend.
Can be executed directly:
    python backend/scripts/migrate.py
or via uv:
    uv run python backend/scripts/migrate.py
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

# Load .env
load_dotenv(backend_dir / ".env")
load_dotenv(backend_dir.parent / ".env")

from db.session import engine
from sqlalchemy import inspect, text


def run_migrations():
    print(f"Connecting to database: {engine.url.render_as_string(hide_password=True)} ({engine.dialect.name})")

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    print(f"Existing tables before migration: {sorted(existing_tables)}")

    # 1. Conversations table column migrations
    if "conversations" in existing_tables:
        print("\nChecking 'conversations' columns...")
        cols = {c["name"] for c in inspector.get_columns("conversations")}
        with engine.begin() as conn:
            if "persona" in cols and "agent" not in cols:
                print(" - Renaming column 'persona' -> 'agent'")
                conn.execute(text("ALTER TABLE conversations RENAME COLUMN persona TO agent;"))
            elif "agent" not in cols:
                print(" - Adding column 'agent'")
                conn.execute(text("ALTER TABLE conversations ADD COLUMN agent VARCHAR(50) DEFAULT 'personal assistant' NOT NULL;"))

            if "active_skill" not in cols:
                print(" - Adding column 'active_skill'")
                conn.execute(text("ALTER TABLE conversations ADD COLUMN active_skill VARCHAR(50) DEFAULT NULL;"))

            if "is_pinned" not in cols:
                print(" - Adding column 'is_pinned'")
                conn.execute(text("ALTER TABLE conversations ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE NOT NULL;"))

            if "source" not in cols:
                print(" - Adding column 'source'")
                conn.execute(text("ALTER TABLE conversations ADD COLUMN source VARCHAR(50) DEFAULT 'telegram' NOT NULL;"))
            print("  'conversations' columns up to date.")

    # 2. Tool invocations
    print("\nChecking 'tool_invocations'...")
    if "tool_invocations" not in existing_tables:
        print(" - Creating table 'tool_invocations'")
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE tool_invocations (
                    request_id VARCHAR(50) PRIMARY KEY,
                    tool_name VARCHAR(100) NOT NULL,
                    status VARCHAR(50) NOT NULL,
                    result TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
    else:
        print("  'tool_invocations' exists.")

    # 3. Sync messages
    print("\nChecking 'sync_messages'...")
    if "sync_messages" not in existing_tables:
        print(" - Creating table 'sync_messages'")
        conv_id_type = "UUID" if engine.dialect.name == "postgresql" else "VARCHAR(255)"
        with engine.begin() as conn:
            conn.execute(text(f"""
                CREATE TABLE sync_messages (
                    id VARCHAR(50) PRIMARY KEY,
                    conversation_id {conv_id_type} NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    content TEXT NOT NULL,
                    provider VARCHAR(50) NOT NULL,
                    created_at BIGINT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );
            """))
    else:
        print("  'sync_messages' exists.")

    # 4. System settings
    print("\nChecking 'system_settings'...")
    if "system_settings" not in existing_tables:
        print(" - Creating table 'system_settings'")
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE system_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
                );
            """))
    else:
        cols = {c["name"] for c in inspector.get_columns("system_settings")}
        if "updated_at" not in cols:
            print(" - Adding column 'updated_at' to 'system_settings'")
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;"))
        print("  'system_settings' exists and is up to date.")

    # 5. Briefings
    print("\nChecking 'briefings'...")
    if "briefings" not in existing_tables:
        print(" - Creating table 'briefings'")
        created_at_default = "timezone('utc'::text, now())" if engine.dialect.name == "postgresql" else "CURRENT_TIMESTAMP"
        with engine.begin() as conn:
            conn.execute(text(f"""
                CREATE TABLE briefings (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(255),
                    date VARCHAR(10) NOT NULL,
                    summary_text TEXT,
                    sections_json JSON,
                    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT {created_at_default} NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_briefings_date ON briefings(date);
            """))
    else:
        print("  'briefings' exists.")

    # 6. OAuth tokens composite PK (T2: multi-provider per conversation)
    print("\nChecking 'oauth_tokens' primary key...")
    migrate_oauth_tokens_composite_pk(engine)

    # Verification
    inspector = inspect(engine)
    final_tables = set(inspector.get_table_names())
    print(f"\nMigration complete! Current tables: {sorted(final_tables)}")


def migrate_oauth_tokens_composite_pk(engine):
    """Migrate oauth_tokens PK (conversation_id) -> (conversation_id, provider).

    Lets one Conversation hold google + future providers. Existing
    single-provider rows migrate cleanly (conversation_id was unique).
    Returns True if a migration was applied.
    """
    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(engine)
    if "oauth_tokens" not in inspector.get_table_names():
        return False
    pk_cols = set(
        (inspector.get_pk_constraint("oauth_tokens") or {}).get("constrained_columns", [])
    )
    if pk_cols != {"conversation_id"}:
        print("  'oauth_tokens' PK already composite, skipping.")
        return False
    print("  Migrating 'oauth_tokens' PK -> (conversation_id, provider)...")
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE oauth_tokens DROP CONSTRAINT IF EXISTS oauth_tokens_pkey;"))
            conn.execute(text("ALTER TABLE oauth_tokens ALTER COLUMN provider SET NOT NULL;"))
            conn.execute(text("ALTER TABLE oauth_tokens ADD PRIMARY KEY (conversation_id, provider);"))
    else:
        # SQLite cannot drop PK constraints; rebuild preserving rows.
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE oauth_tokens RENAME TO oauth_tokens_legacy;"))
            conn.execute(text("""
                CREATE TABLE oauth_tokens (
                    conversation_id VARCHAR(255) NOT NULL,
                    provider VARCHAR(50) NOT NULL,
                    token_data JSON NOT NULL,
                    created_at TIMESTAMP,
                    updated_at TIMESTAMP,
                    PRIMARY KEY (conversation_id, provider),
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );
            """))
            conn.execute(text("INSERT INTO oauth_tokens SELECT conversation_id, provider, token_data, created_at, updated_at FROM oauth_tokens_legacy;"))
            conn.execute(text("DROP TABLE oauth_tokens_legacy;"))
    print("  'oauth_tokens' PK migration applied.")
    return True


if __name__ == "__main__":
    run_migrations()

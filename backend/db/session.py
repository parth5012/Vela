"""
Database session management module.
Configures the SQLAlchemy engine and provides a thread-safe context manager
for handling session scopes, commits, rollbacks, and clean close operations.
"""

import os
import sys
from contextlib import contextmanager
from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
IS_TESTING = "pytest" in sys.modules or "unittest" in sys.modules or os.getenv("PYTEST_CURRENT_TEST") is not None

if IS_TESTING:
    DATABASE_URL = "sqlite:///test_vela_backend.db"

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in the environment variables.")

# Tables safe to create_all on SQLite. pgvector's Vector type has no SQLite
# DDL, so memory_vectors is excluded here (Postgres-only, created via the
# full create_all in ensure_prod_schema or schema.sql).
SQLITE_SAFE_TABLES = ["conversations", "oauth_tokens", "experiences", "system_prompt_fragments", "skills_registry", "tool_invocations", "sync_messages", "system_settings", "briefings", "check_ins", "pending_client_mailbox"]

# Create the engine
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy.pool import NullPool
    engine = create_engine(DATABASE_URL, poolclass=NullPool)

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    from db.models import Base
    sqlite_tables = [
        Base.metadata.tables[name]
        for name in SQLITE_SAFE_TABLES
        if name in Base.metadata.tables
    ]
    Base.metadata.create_all(bind=engine, tables=sqlite_tables)
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def ensure_prod_schema(db_engine=None):
    """Idempotent prod DDL guard (wayfinder T8).

    DDL CHOICE: ``Base.metadata.create_all`` (check_first=True), NOT Alembic.
    Rationale: the codebase has no Alembic chain and the lifespan/migrate
    steps are already idempotent inspector-gated raw SQL; a minimal Alembic
    setup would add version-table bootstrap complexity for zero gain on a
    single-tenant backend. ``create_all`` is a no-op when tables exist, so
    calling it on every boot and at the top of ``migrate.py`` cannot drift:
    both paths converge on ``db.models`` as the single source of truth, and
    the inspector-gated ALTERs below/there only backfill legacy columns.

    On Postgres this also ensures the ``vector``/``pgcrypto`` extensions
    (needed by ``memory_vectors.embedding`` and ``gen_random_uuid()``
    defaults) before creating tables. On SQLite only ``SQLITE_SAFE_TABLES``
    are created (pgvector has no SQLite DDL). Never raises: boot must not
    fail on the DDL guard — per-block migrations log and continue.
    """
    from sqlalchemy import text as _text

    eng = db_engine if db_engine is not None else engine
    try:
        if eng.dialect.name == "postgresql":
            try:
                with eng.begin() as conn:
                    conn.execute(_text("CREATE EXTENSION IF NOT EXISTS vector"))
            except Exception:
                pass
            try:
                with eng.begin() as conn:
                    conn.execute(_text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
            except Exception:
                pass
        from db.models import Base as _Base
        if eng.dialect.name == "postgresql":
            _Base.metadata.create_all(bind=eng)
        else:
            _tables = [
                _Base.metadata.tables[name]
                for name in SQLITE_SAFE_TABLES
                if name in _Base.metadata.tables
            ]
            _Base.metadata.create_all(bind=eng, tables=_tables)
    except Exception:
        pass

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@contextmanager
def get_db_session():
    """Context manager for thread-safe SQLAlchemy database sessions.

    TRANSACTION RULE (wayfinder T3, issue #251): this context OWNS the
    transaction — a clean exit commits, any exception rolls back and
    re-raises. Callers MUST NOT call ``session.commit()`` inside the block;
    just mutate (``DBClient`` methods ``flush()`` only, never commit) and let
    the context commit. Several call sites (e.g. briefing/check-in endpoints
    in ``agent/main.py``) rely solely on this exit-commit, so removing it
    would silently drop writes.
    """
    db: Session = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

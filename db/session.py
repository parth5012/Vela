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

# Create the engine
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL)
    
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        
    from db.models import Base
    sqlite_tables = [
        Base.metadata.tables[name]
        for name in ["conversations", "oauth_tokens", "experiences", "system_prompt_fragments", "skills_registry"]
    ]
    Base.metadata.create_all(bind=engine, tables=sqlite_tables)
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@contextmanager
def get_db_session():
    """Context manager for thread-safe SQLAlchemy database sessions."""
    db: Session = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

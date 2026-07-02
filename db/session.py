"""
Database session management module.
Configures the SQLAlchemy engine and provides a thread-safe context manager
for handling session scopes, commits, rollbacks, and clean close operations.
"""

import os
from contextlib import contextmanager
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set in the environment variables.")

# Create the engine using pool configuration to keep connection alive and auto-reconnect
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

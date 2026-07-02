import pytest
from db.session import get_db_session
from sqlalchemy.orm import Session

def test_get_db_session():
    with get_db_session() as session:
        assert isinstance(session, Session)
        # Run a simple raw SQL query to test connectivity
        from sqlalchemy import text
        result = session.execute(text("SELECT 1")).scalar()
        assert result == 1

import os
import pytest
from db.session import engine

@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db():
    yield
    
    # Dispose of the SQLAlchemy engine to close all connections
    try:
        engine.dispose()
    except Exception:
        pass
        
    db_file = "test_vela_backend.db"
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
        except Exception as e:
            print(f"Failed to remove test database file {db_file}: {e}")

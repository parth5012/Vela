"""Prototype for ticket #544 — per-test isolated SQLite DB harness.

Demonstrates that repository/migration-level behavior can be tested against a
real, per-test-isolated SQLite database (fresh temp file per test, real
foreign keys enforced) instead of the shared ``test_vela_backend.db``.

AFK ticket #548 generalizes this into the standard fixture and migrates the
repository suites onto it.
"""

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from db.models import Conversation, OAuthToken


def _conversation_count(isolated_db) -> int:
    with isolated_db.session() as s:
        return s.execute(select(func.count()).select_from(Conversation)).scalar_one()


def test_a_row_written_here_exists_only_in_this_test_db(isolated_db):
    with isolated_db.session() as s:
        conv = Conversation(title="prototype one")
        s.add(conv)
    assert _conversation_count(isolated_db) == 1


def test_b_each_test_gets_a_fresh_database(isolated_db):
    # Runs after test_a; a shared database would still hold its row.
    assert _conversation_count(isolated_db) == 0


def test_c_foreign_keys_are_enforced(isolated_db):
    # Same transaction rule as get_db_session: an exception at commit is
    # rolled back and re-raised, so the FK violation surfaces to the caller.
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        with isolated_db.session() as s:
            s.add(
                OAuthToken(
                    conversation_id="no-such-conversation",
                    provider="google",
                    token={"a": "b"},
                )
            )

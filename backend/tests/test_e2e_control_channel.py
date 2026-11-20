"""Tests for backend deterministic E2E control channel and extended script grammar.

Covers:
- POST /_e2e/fixture with named scenarios (default, populated_threads, briefing_history, error_turn, delay_stream)
- POST /_e2e/fixture error on unknown fixture name (HTTP 400)
- GET /_e2e/state exposing available_fixtures
- POST /_e2e/reset clearing database and provider state
- FakeProvider {"kind": "error", "message": "..."} streaming error SSE event
- FakeProvider {"kind": "delay", "ms": N, "chunks": [...]} chunk pacing
"""

from __future__ import annotations

import os
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from agent.spec import ErrorSSEEvent, validate_sse_line
from agent.testing.e2e_server import (
    E2E_API_KEY,
    _FIXTURE_REGISTRY,
    create_e2e_app,
    teardown_e2e_app,
)
from agent.testing.provider import FakeProvider


@pytest.fixture
def e2e_client(monkeypatch):
    """TestClient wired with VELA_E2E=1 and create_e2e_app()."""
    monkeypatch.setenv("VELA_E2E", "1")
    app = create_e2e_app()
    client = TestClient(app)
    try:
        yield client
    finally:
        client.close()
        teardown_e2e_app()


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {E2E_API_KEY}"}


def _collect_sse_events(response: Any) -> list[Any]:
    events = []
    for line in response.iter_lines():
        if not line or line.startswith(":"):
            continue
        event = validate_sse_line(line)
        events.append(event)
    return events


# ===========================================================================
# 1. Named Fixtures Endpoint
# ===========================================================================


def test_e2e_fixture_registry_is_enumerable(e2e_client):
    """GET /_e2e/state must expose the sorted list of available fixtures."""
    resp = e2e_client.get("/_e2e/state")
    assert resp.status_code == 200
    data = resp.json()
    assert "available_fixtures" in data
    assert sorted(data["available_fixtures"]) == sorted(_FIXTURE_REGISTRY.keys())
    assert "default" in data["available_fixtures"]
    assert "populated_threads" in data["available_fixtures"]
    assert "briefing_history" in data["available_fixtures"]
    assert "error_turn" in data["available_fixtures"]
    assert "delay_stream" in data["available_fixtures"]


def test_e2e_fixture_seeding_and_reset(e2e_client):
    """POST /_e2e/fixture seeds named scenarios and POST /_e2e/reset clears them."""
    # 1. Seed populated_threads fixture
    resp = e2e_client.post("/_e2e/fixture", json={"name": "populated_threads"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["fixture"] == "populated_threads"
    assert len(data["details"]["threads"]) == 5

    # Check threads via /chat/threads
    threads_resp = e2e_client.get("/chat/threads", headers=_auth_headers())
    assert threads_resp.status_code == 200
    assert len(threads_resp.json()) == 5

    # 2. Seed briefing_history fixture
    resp = e2e_client.post("/_e2e/fixture", json={"name": "briefing_history"})
    assert resp.status_code == 200
    assert len(resp.json()["details"]["briefings"]) == 5

    # Check briefings history via API
    briefings_resp = e2e_client.get("/api/briefings?days=14", headers=_auth_headers())
    assert briefings_resp.status_code == 200
    assert len(briefings_resp.json()) == 5

    # 3. Reset
    reset_resp = e2e_client.post("/_e2e/reset")
    assert reset_resp.status_code == 200
    assert reset_resp.json()["ok"] is True

    # After reset, threads are back to 2 default threads
    after_threads = e2e_client.get("/chat/threads", headers=_auth_headers()).json()
    assert len(after_threads) == 2


def test_e2e_fixture_unknown_name_returns_400(e2e_client):
    """POST /_e2e/fixture with unknown name returns HTTP 400 with available fixtures."""
    resp = e2e_client.post("/_e2e/fixture", json={"name": "non_existent_fixture"})
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "Unknown fixture 'non_existent_fixture'" in detail
    assert "Available:" in detail


# ===========================================================================
# 2. Script Grammar: Error and Delay Turns
# ===========================================================================


def test_fake_provider_error_turn_direct():
    """FakeProvider directly raises RuntimeError on error turn."""
    provider = FakeProvider()
    provider.add_script({"kind": "error", "message": "Direct error test"})

    from langchain_core.messages import HumanMessage

    with pytest.raises(RuntimeError) as exc_info:
        provider.invoke([HumanMessage(content="Hello")])
    assert "Direct error test" in str(exc_info.value)


def test_fake_provider_delay_turn_direct():
    """FakeProvider delays execution according to ms parameter."""
    provider = FakeProvider()
    provider.add_script({
        "kind": "delay",
        "ms": 50,
        "chunks": ["chunk1", "chunk2"],
    })

    from langchain_core.messages import HumanMessage

    start = time.perf_counter()
    raw_chunks = list(provider.stream([HumanMessage(content="Hello")]))
    chunks = [c for c in raw_chunks if c.content]
    elapsed = time.perf_counter() - start

    assert len(chunks) == 2
    assert [c.content for c in chunks] == ["chunk1", "chunk2"]
    # 2 chunks * 50ms delay = ~100ms total delay
    assert elapsed >= 0.08


def test_e2e_error_turn_streams_sse_error(e2e_client):
    """Scripted error turn produces ErrorSSEEvent in the live /chat/message stream."""
    reset_resp = e2e_client.post("/_e2e/reset")
    thread_id = reset_resp.json()["thread_id"]

    script_resp = e2e_client.post(
        "/_e2e/script",
        json={"turns": [{"kind": "error", "message": "Custom test failure"}]},
    )
    assert script_resp.status_code == 200

    payload = {"thread_id": thread_id, "message": "Trigger failure"}
    with e2e_client.stream("POST", "/chat/message", json=payload, headers=_auth_headers()) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    error_events = [e for e in events if isinstance(e, ErrorSSEEvent)]
    assert len(error_events) == 1
    assert "Custom test failure" in error_events[0].message


def test_e2e_fixture_error_turn_scenario(e2e_client):
    """The 'error_turn' named fixture pre-scripts an error for /chat/message."""
    fixture_resp = e2e_client.post("/_e2e/fixture", json={"name": "error_turn"})
    assert fixture_resp.status_code == 200

    # Get a thread to message
    state_resp = e2e_client.get("/_e2e/state")
    thread_id = state_resp.json()["threads"][0]["id"]

    payload = {"thread_id": thread_id, "message": "Hello"}
    with e2e_client.stream("POST", "/chat/message", json=payload, headers=_auth_headers()) as resp:
        assert resp.status_code == 200
        events = _collect_sse_events(resp)

    error_events = [e for e in events if isinstance(e, ErrorSSEEvent)]
    assert len(error_events) == 1
    assert "Deterministic simulated backend failure" in error_events[0].message

"""Tests for tools/pending_tasks.py registry behavior.

Focus of the audit fix: each PENDING_TASKS entry now records the event loop
(`loop`) that created it, so server endpoints can wake the waiter safely from
another thread via `loop.call_soon_threadsafe`.
"""

import asyncio

import pytest

import tools.pending_tasks as pt


@pytest.fixture(autouse=True)
def clean_registry():
    """Ensure the shared registries are empty before and after each test."""
    pt.PENDING_TASKS.clear()
    pt.LAST_TOOL_START_TOKENS.clear()
    yield
    pt.PENDING_TASKS.clear()
    pt.LAST_TOOL_START_TOKENS.clear()


@pytest.mark.asyncio
async def test_registry_entry_records_running_loop():
    """A registered wait must record the running loop for cross-thread wakeup."""
    loop = asyncio.get_running_loop()

    async def respond_once():
        await asyncio.sleep(0.01)
        entry = pt.PENDING_TASKS["conv-loop-check"]
        assert entry["event"] is not None
        # The audit fix: the entry carries the creating event loop.
        assert entry["loop"] is loop
        entry["response"] = {"status": "success", "result": "ok"}
        entry["event"].set()

    responder = asyncio.create_task(respond_once())
    status, result = await pt.wait_for_client_event("conv-loop-check", timeout=5)
    await responder

    assert status == "success"
    assert result == "ok"


@pytest.mark.asyncio
async def test_registry_entry_removed_after_response():
    """Successful completion must pop the registry entry (no stale entries)."""
    key = "conv-cleanup-success"

    async def respond_once():
        await asyncio.sleep(0.01)
        pt.PENDING_TASKS[key]["response"] = {"status": "error", "result": "denied"}
        pt.PENDING_TASKS[key]["event"].set()

    responder = asyncio.create_task(respond_once())
    status, result = await pt.wait_for_client_event(key, timeout=5)
    await responder

    assert status == "error"
    assert result == "denied"
    assert key not in pt.PENDING_TASKS


@pytest.mark.asyncio
async def test_timeout_cleans_up_registry_entry():
    """Timing out must remove the entry so late responses don't hit ghosts."""
    status, result = await pt.wait_for_client_event(
        "conv-timeout",
        timeout=0.05,
        timeout_message="timed out!",
    )
    assert status == "timeout"
    assert result == "timed out!"
    assert "conv-timeout" not in pt.PENDING_TASKS


@pytest.mark.asyncio
async def test_task_token_key_namespacing():
    """With a task_token the registry key must be '<conversation>_<token>'."""
    seen_keys = {}

    async def capture_key():
        await asyncio.sleep(0.01)
        seen_keys.update(pt.PENDING_TASKS)
        for entry in pt.PENDING_TASKS.values():
            entry["response"] = {"status": "success", "result": "done"}
            entry["event"].set()

    responder = asyncio.create_task(capture_key())
    status, _ = await pt.wait_for_client_event(
        "conv-abc", task_token="tok-123", timeout=5
    )
    await responder

    assert status == "success"
    assert list(seen_keys.keys()) == ["conv-abc_tok-123"]

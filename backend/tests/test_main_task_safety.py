"""Tests for agent/main.py async task-safety helpers.

Audit-fix coverage:
- ``_safe_set_event`` must wake a pending task's event via
  ``loop.call_soon_threadsafe`` when called from another thread (the old code
  called ``event.set()`` directly cross-thread, which races).
- ``create_background_task`` must hold a strong reference in BACKGROUND_TASKS
  until the task completes, preventing garbage collection of fire-and-forget
  tasks.
"""

import asyncio

import pytest

from agent.main import BACKGROUND_TASKS, _safe_set_event, create_background_task


@pytest.mark.asyncio
async def test_safe_set_event_wakes_waiter_from_another_thread():
    """Cross-thread response submission must wake the awaiting loop."""
    loop = asyncio.get_running_loop()
    event = asyncio.Event()
    task_data = {"event": event, "loop": loop}

    # Simulate FastAPI's threadpool thread calling back into the running loop.
    await asyncio.to_thread(_safe_set_event, task_data)

    await asyncio.wait_for(event.wait(), timeout=2.0)
    assert event.is_set()


@pytest.mark.asyncio
async def test_safe_set_event_falls_back_to_current_loop_without_recorded_loop():
    """Entries missing 'loop' still get set via the current running loop."""
    event = asyncio.Event()
    task_data = {"event": event}  # no "loop" key

    _safe_set_event(task_data)

    await asyncio.wait_for(event.wait(), timeout=2.0)
    assert event.is_set()


def test_safe_set_event_direct_fallback_outside_event_loop():
    """With no recorded loop and no running loop, set the event directly."""
    event = asyncio.Event()
    _safe_set_event({"event": event})
    assert event.is_set()


def test_safe_set_event_noop_without_event():
    """Missing/None event must not raise (defensive negative path)."""
    assert _safe_set_event({}) is None
    assert _safe_set_event({"event": None}) is None


@pytest.mark.asyncio
async def test_create_background_task_tracked_while_running():
    """The task stays strongly referenced while it is pending."""
    started = asyncio.Event()
    release = asyncio.Event()

    async def work():
        started.set()
        await release.wait()

    before = set(BACKGROUND_TASKS)
    task = create_background_task(work())
    try:
        await asyncio.wait_for(started.wait(), timeout=2.0)
        assert task in BACKGROUND_TASKS
    finally:
        release.set()
        await task

    # Done callback discards it once complete.
    await asyncio.sleep(0)
    assert task not in BACKGROUND_TASKS
    assert set(BACKGROUND_TASKS) == before


@pytest.mark.asyncio
async def test_create_background_task_discards_after_exception():
    """A crashing background task must still be discarded from the registry."""
    async def boom():
        raise RuntimeError("background failure")

    task = create_background_task(boom())
    with pytest.raises(RuntimeError, match="background failure"):
        await task
    await asyncio.sleep(0)
    assert task not in BACKGROUND_TASKS

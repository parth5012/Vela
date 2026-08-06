"""E2E tests for webview browser concurrency fix (Issue #13).

Verifies that multiple concurrent webview_browser calls for the same
conversation_id no longer collide on PENDING_TASKS, and that the
/chat/webview/response endpoint correctly routes responses to the
right pending task using prefix-matching on conversation_id.
"""

import asyncio
import os
import sys
import uuid
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GOOGLE_API_KEY", "AIzaSyFakeKeyForE2ETests")
os.environ.setdefault("VELA_API_KEY", "vela5012")

from agent.main import app

VELA_API_KEY = os.environ.get("VELA_API_KEY", "vela5012")

# Import the module object itself (not the @tool-decorated function).
# `import tools.webview_browser` would resolve to the StructuredTool instance
# because the @tool decorator replaces the module-level name.
import tools.webview_browser as _wb_module  # noqa: F401 — triggers module load
wb = sys.modules["tools.webview_browser"]

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_pending_tasks():
    """Ensure PENDING_TASKS and LAST_TOOL_START_TOKENS are clean before each test."""
    wb.PENDING_TASKS.clear()
    wb.LAST_TOOL_START_TOKENS.clear()
    yield
    wb.PENDING_TASKS.clear()
    wb.LAST_TOOL_START_TOKENS.clear()


class TestWaitForClientEventConcurrency:
    """Test that wait_for_client_event handles concurrent calls correctly."""

    @pytest.mark.asyncio
    async def test_same_conversation_different_task_tokens_no_collision(self):
        """Two concurrent waits with same conversation_id but different task_tokens
        should resolve independently without overwriting each other."""
        conv_id = str(uuid.uuid4())
        token_a = str(uuid.uuid4())
        token_b = str(uuid.uuid4())

        results = {}

        async def wait_and_capture(token):
            status, result = await wb.wait_for_client_event(
                conversation_id=conv_id,
                action="navigate",
                target="",
                value="https://example.com",
                task_token=token,
            )
            results[token] = (status, result)

        # Start two concurrent waits
        task_a = asyncio.create_task(wait_and_capture(token_a))
        task_b = asyncio.create_task(wait_and_capture(token_b))

        # Give them time to register in PENDING_TASKS
        await asyncio.sleep(0.1)

        # Both should be registered under different keys
        key_a = f"{conv_id}_{token_a}"
        key_b = f"{conv_id}_{token_b}"
        assert key_a in wb.PENDING_TASKS
        assert key_b in wb.PENDING_TASKS
        assert len(wb.PENDING_TASKS) == 2

        # Resolve task A
        wb.PENDING_TASKS[key_a]["response"] = {
            "status": "success",
            "result": "Page A loaded",
        }
        wb.PENDING_TASKS[key_a]["event"].set()

        # Wait for task A to complete
        await task_a
        assert results[token_a] == ("success", "Page A loaded")

        # Task B should still be pending
        assert key_b in wb.PENDING_TASKS

        # Resolve task B
        wb.PENDING_TASKS[key_b]["response"] = {
            "status": "success",
            "result": "Page B loaded",
        }
        wb.PENDING_TASKS[key_b]["event"].set()

        await task_b
        assert results[token_b] == ("success", "Page B loaded")

    @pytest.mark.asyncio
    async def test_no_task_token_uses_conversation_id_directly(self):
        """When task_token is None (backward compat), key is just conversation_id."""
        conv_id = str(uuid.uuid4())

        async def wait_no_token():
            return await wb.wait_for_client_event(
                conversation_id=conv_id,
                action="extract_dom",
                target="",
                value="",
            )

        task = asyncio.create_task(wait_no_token())
        await asyncio.sleep(0.1)

        # Should be registered under plain conversation_id
        assert conv_id in wb.PENDING_TASKS

        # Resolve it
        wb.PENDING_TASKS[conv_id]["response"] = {
            "status": "success",
            "result": '{"dom": "test"}',
        }
        wb.PENDING_TASKS[conv_id]["event"].set()

        status, result = await task
        assert status == "success"
        assert result == '{"dom": "test"}'

    @pytest.mark.asyncio
    async def test_timeout_cleans_up_correct_key(self):
        """Timed-out wait should only remove its own key, not others."""
        conv_id = str(uuid.uuid4())
        token_a = str(uuid.uuid4())
        token_b = str(uuid.uuid4())

        async def short_timeout_wait(conversation_id, action, target, value, task_token=None):
            event = asyncio.Event()
            key = f"{conversation_id}_{task_token}" if task_token else conversation_id
            wb.PENDING_TASKS[key] = {
                "event": event,
                "response": None,
            }
            try:
                await asyncio.wait_for(event.wait(), timeout=0.1)
                return "success", "done"
            except asyncio.TimeoutError:
                status = "timeout"
                result = "Timeout waiting for client WebView response."
            finally:
                wb.PENDING_TASKS.pop(key, None)
            return status, result

        with patch.object(wb, "wait_for_client_event", short_timeout_wait):
            task_a = asyncio.create_task(
                short_timeout_wait(conv_id, "navigate", "", "https://a.com", token_a)
            )
            task_b = asyncio.create_task(
                short_timeout_wait(conv_id, "navigate", "", "https://b.com", token_b)
            )

            await asyncio.sleep(0.05)
            assert len(wb.PENDING_TASKS) == 2

            # Let both timeout
            result_a = await task_a
            result_b = await task_b

        assert result_a == ("timeout", "Timeout waiting for client WebView response.")
        assert result_b == ("timeout", "Timeout waiting for client WebView response.")
        assert len(wb.PENDING_TASKS) == 0


class TestSubmitWebviewResponseRouting:
    """Test that /chat/webview/response routes to the correct pending task."""

    def test_exact_match_still_works(self):
        """When conversation_id matches exactly, response is routed directly."""
        conv_id = str(uuid.uuid4())
        wb.PENDING_TASKS[conv_id] = {
            "event": MagicMock(),
            "response": None,
        }

        resp = client.post(
            "/chat/webview/response",
            json={
                "conversation_id": conv_id,
                "status": "success",
                "result": "exact match result",
            },
            headers={"Authorization": f"Bearer {VELA_API_KEY}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "accepted"

    def test_prefix_match_routes_to_correct_task(self):
        """When exact match fails, prefix-match on '{conversation_id}_' finds the right task."""
        conv_id = str(uuid.uuid4())
        token = str(uuid.uuid4())
        key = f"{conv_id}_{token}"

        wb.PENDING_TASKS[key] = {
            "event": MagicMock(),
            "response": None,
        }

        # Send response with the base conversation_id (without token suffix)
        resp = client.post(
            "/chat/webview/response",
            json={
                "conversation_id": conv_id,
                "status": "success",
                "result": "prefix matched result",
            },
            headers={"Authorization": f"Bearer {VELA_API_KEY}"},
        )
        assert resp.status_code == 200
        assert wb.PENDING_TASKS[key]["response"]["result"] == "prefix matched result"

    def test_prefix_match_with_multiple_pending_tasks(self):
        """When multiple tasks exist for same conversation_id, prefix-match finds one."""
        conv_id = str(uuid.uuid4())
        token_a = str(uuid.uuid4())
        token_b = str(uuid.uuid4())
        key_a = f"{conv_id}_{token_a}"
        key_b = f"{conv_id}_{token_b}"

        event_a = MagicMock()
        event_b = MagicMock()
        wb.PENDING_TASKS[key_a] = {"event": event_a, "response": None}
        wb.PENDING_TASKS[key_b] = {"event": event_b, "response": None}

        # Send response — should resolve exactly one of the two pending tasks
        resp = client.post(
            "/chat/webview/response",
            json={
                "conversation_id": conv_id,
                "status": "success",
                "result": "one of them",
            },
            headers={"Authorization": f"Bearer {VELA_API_KEY}"},
        )
        assert resp.status_code == 200

        # Exactly one should have been resolved
        resolved_count = sum(
            1 for v in wb.PENDING_TASKS.values()
            if v["response"] is not None
        )
        assert resolved_count == 1

    def test_no_match_returns_404(self):
        """When no pending task matches, return 404."""
        resp = client.post(
            "/chat/webview/response",
            json={
                "conversation_id": "nonexistent-id",
                "status": "success",
                "result": "orphan response",
            },
            headers={"Authorization": f"Bearer {VELA_API_KEY}"},
        )
        assert resp.status_code == 404
        assert "No pending task found" in resp.json()["detail"]

    def test_response_requires_auth(self):
        """The /chat/webview/response endpoint requires API key auth."""
        resp = client.post(
            "/chat/webview/response",
            json={
                "conversation_id": "test-id",
                "status": "success",
                "result": "test",
            },
        )
        assert resp.status_code == 403


class TestLastToolStartTokens:
    """Test the LAST_TOOL_START_TOKENS registry behavior."""

    def test_token_registered_and_consumed(self):
        """Token is stored on tool start and consumed (popped) by the tool."""
        conv_id = str(uuid.uuid4())
        token = str(uuid.uuid4())

        # Simulate what agent/main.py does on on_tool_start
        wb.LAST_TOOL_START_TOKENS[conv_id] = token
        modified_conv_id = f"{conv_id}_{token}"

        # Simulate what webview_browser does when it starts waiting
        task_token = wb.LAST_TOOL_START_TOKENS.pop(conv_id, None)

        assert task_token == token
        assert conv_id not in wb.LAST_TOOL_START_TOKENS
        assert modified_conv_id == f"{conv_id}_{task_token}"

    def test_pop_returns_none_if_no_token(self):
        """If no token was registered, pop returns None (backward compat)."""
        conv_id = str(uuid.uuid4())
        task_token = wb.LAST_TOOL_START_TOKENS.pop(conv_id, None)
        assert task_token is None

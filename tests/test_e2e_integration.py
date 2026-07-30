"""E2E integration tests — multi-agent interactions, tool isolation, auth gates.

Covers:
- Agent selection via the /chat/message streaming API
- Tool isolation (personal assistant vs google_workspace)
- Auth gate responses when credentials are missing
- Platform bot gateways locked to personal assistant
"""

import os
from unittest.mock import patch, MagicMock, AsyncMock, PropertyMock

# Ensure GOOGLE_API_KEY is set so the graph chatbot_node doesn't short-circuit
os.environ.setdefault("GOOGLE_API_KEY", "AIzaSyFakeKeyForE2ETests")
os.environ.setdefault("VELA_API_KEY", "e2e-test-secret-key")


# ---------------------------------------------------------------------------
# 1. Agent Registry — tool isolation verification
# ---------------------------------------------------------------------------

class TestToolIsolation:
    """Verify each agent exposes only its authorised tools."""

    def test_personal_assistant_has_no_credentialed_tools(self):
        from agent.registry import AGENT_REGISTRY

        pa = AGENT_REGISTRY.get("personal assistant")
        assert pa is not None
        tool_names = pa.tool_names

        # Must include generic tools
        assert "web_search" in tool_names
        assert "save_user_memory" in tool_names
        assert "run_python_code" in tool_names

        # Must NOT include credentialed Google tools
        assert "gmail_send_email" not in tool_names
        assert "gmail_read_emails" not in tool_names
        assert "calendar_list_events" not in tool_names
        assert "calendar_create_event" not in tool_names

    def test_google_workspace_has_credentialed_tools(self):
        from agent.registry import AGENT_REGISTRY

        gw = AGENT_REGISTRY.get("google_workspace")
        assert gw is not None
        tool_names = gw.tool_names

        # Must include credentialed tools
        assert "gmail_send_email" in tool_names
        assert "gmail_read_emails" in tool_names
        assert "calendar_list_events" in tool_names
        assert "calendar_create_event" in tool_names

    def test_teacher_analyst_prompt_builder_have_no_credentialed_tools(self):
        from agent.registry import AGENT_REGISTRY

        for agent_id in ["teacher", "analyst", "prompt builder"]:
            cfg = AGENT_REGISTRY.get(agent_id)
            for tool in ["gmail_send_email", "gmail_read_emails", "calendar_list_events", "calendar_create_event"]:
                assert tool not in cfg.tool_names, f"{agent_id} should not have {tool}"

    def test_tools_list_includes_all_tools(self):
        """All credentialed tools must be in the master tools_list for ToolNode."""
        from tools import tools_list

        tool_names = [t.name for t in tools_list]
        assert "gmail_send_email" in tool_names
        assert "gmail_read_emails" in tool_names
        assert "calendar_list_events" in tool_names
        assert "calendar_create_event" in tool_names


# ---------------------------------------------------------------------------
# 2. Auth gate responses when credentials are missing
# ---------------------------------------------------------------------------

class TestAuthGateIntegration:
    """Verify the auth gate returns proper signals for unauthenticated calls."""

    def test_ensure_google_auth_no_tokens(self):
        from utils.auth_gate import ensure_google_auth, AUTH_REQUIRED

        mock_db = MagicMock()
        mock_db.get_oauth_tokens.return_value = None

        result = ensure_google_auth("e2e-conv-no-tokens", mock_db)
        assert result is AUTH_REQUIRED
        assert result["status"] == "auth_required"
        assert result["provider"] == "google"

    def test_ensure_google_auth_expired_tokens(self):
        from utils.auth_gate import ensure_google_auth, AUTH_REQUIRED

        token_data = {
            "access_token": "at-stale",
            "refresh_token": "rt-stale",
            "expiry": "2024-01-01T00:00:00Z",
        }
        mock_db = MagicMock()
        mock_db.get_oauth_tokens.return_value = token_data

        mock_creds = MagicMock()
        mock_creds.expired = True
        mock_creds.refresh_token = "rt-stale"
        mock_creds.token = "at-fresh"
        mock_creds.scopes = None
        from datetime import datetime, timezone
        mock_creds.expiry = datetime.now(timezone.utc)

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CLIENT_SECRET": "cs"}):
            with patch("utils.auth_gate.Credentials", return_value=mock_creds):
                with patch("utils.auth_gate.Request"):
                    result = ensure_google_auth("e2e-conv-refresh", mock_db)

        assert result is not AUTH_REQUIRED
        assert result is mock_creds
        mock_creds.refresh.assert_called_once()
        mock_db.store_oauth_tokens.assert_called_once()


# ---------------------------------------------------------------------------
# 3. Agent selection via /chat/message API
# ---------------------------------------------------------------------------

class TestAgentSelectionAPI:
    """Verify that selecting agents via the streaming API works end-to-end."""

    def test_stream_chat_selects_google_workspace_agent(self):
        """The google_workspace agent must be accepted and return an SSE stream."""
        from fastapi.testclient import TestClient
        from agent.main import app

        client = TestClient(app)
        headers = {"Authorization": "Bearer e2e-test-secret-key"}
        payload = {
            "thread_id": "e2e-gw-thread",
            "message": "Show my emails",
            "agent": "google_workspace",
        }

        with client.stream("POST", "/chat/message", json=payload, headers=headers) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]

    def test_stream_chat_rejects_unknown_agent(self):
        from fastapi.testclient import TestClient
        from agent.main import app

        client = TestClient(app)
        headers = {"Authorization": "Bearer e2e-test-secret-key"}
        payload = {
            "thread_id": "e2e-unknown-thread",
            "message": "hello",
            "agent": "nonexistent_agent",
        }

        resp = client.post("/chat/message", json=payload, headers=headers)
        assert resp.status_code == 400
        assert "Unsupported agent" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 4. Platform bot gateways locked to personal assistant
# ---------------------------------------------------------------------------

class TestGatewayAgentLock:
    """Verify platform gateways hardcode 'personal assistant' as the agent."""

    def test_telegram_gateway_hardcodes_personal_assistant(self):
        from gateway.telegram import TelegramGateway

        # Mock everything that touches external services
        with patch("gateway.telegram.Bot"), \
             patch("gateway.telegram.Update.de_json") as mock_dejson, \
             patch("gateway.telegram.graph.ainvoke", new_callable=AsyncMock) as mock_ainvoke:

            mock_update = MagicMock()
            mock_update.effective_chat.id = 999
            mock_update.effective_message.text = "hello"
            mock_dejson.return_value = mock_update

            mock_ainvoke.return_value = {"messages": [MagicMock(content="Hi!")]}

            db = MagicMock()
            db.get_or_create_conversation.return_value = "e2e-telegram-conv"

            gateway = TelegramGateway(db=db)
            import asyncio
            asyncio.run(gateway.handle_update({"update_id": 1}))

            # Verify the graph was called with agent="personal assistant"
            call_kwargs = mock_ainvoke.call_args[0][0]
            assert call_kwargs["agent"] == "personal assistant", \
                f"Expected personal assistant, got {call_kwargs['agent']}"

    @patch("gateway.carbonvoice.graph.ainvoke", new_callable=AsyncMock)
    @patch("gateway.carbonvoice.upload_to_google_drive")
    @patch("gateway.carbonvoice.get_google_credentials")
    @patch("gateway.carbonvoice.httpx.AsyncClient.get")
    def test_carbonvoice_gateway_hardcodes_personal_assistant(
        self,
        mock_httpx_get,
        mock_get_creds,
        mock_upload,
        mock_ainvoke,
    ):
        from gateway.carbonvoice import CarbonVoiceGateway

        mock_get_creds.return_value = None
        mock_upload.return_value = None
        mock_ainvoke.return_value = {
            "messages": [MagicMock(content="I heard you!")],
        }
        mock_httpx_get.return_value = MagicMock(status_code=200)

        db = MagicMock()
        db.get_or_create_conversation.return_value = "e2e-carbon-conv"

        gateway = CarbonVoiceGateway(db=db)
        import asyncio
        asyncio.run(gateway.handle_webhook(
            payload={"transcript": "hello world", "data": {"conversation_id": "ext-456"}},
        ))

        # Verify graph was called with agent="personal assistant"
        call_kwargs = mock_ainvoke.call_args[0][0]
        assert call_kwargs["agent"] == "personal assistant", \
            f"Expected personal assistant, got {call_kwargs['agent']}"

from agent.registry import AGENT_REGISTRY

def test_registry_compact_prompts():
    agents = AGENT_REGISTRY.list_agents()
    assert len(agents) == 6
    for agent in agents:
        assert agent.compact_prompt_instructions
        assert "<persona>" in agent.compact_prompt_instructions
        assert "</persona>" in agent.compact_prompt_instructions


def test_google_workspace_agent_tool_bindings():
    """Verify google_workspace agent in AGENT_REGISTRY has Gmail and Calendar tool bindings."""
    config = AGENT_REGISTRY.get("google_workspace")
    assert config is not None
    assert config.identifier == "google_workspace"
    assert config.display_name == "Google Workspace"

    expected_tools = [
        "gmail_send_email",
        "gmail_read_emails",
        "calendar_list_events",
        "calendar_create_event",
    ]
    for tool_name in expected_tools:
        assert tool_name in config.tool_names

    # Test get_tool_names helper
    tool_names = AGENT_REGISTRY.get_tool_names("google_workspace")
    for tool_name in expected_tools:
        assert tool_name in tool_names


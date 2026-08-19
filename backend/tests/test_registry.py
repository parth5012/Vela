from agent.registry import AGENT_REGISTRY

def test_registry_compact_prompts():
    agents = AGENT_REGISTRY.list_agents()
    assert len(agents) == 6
    for agent in agents:
        assert agent.compact_prompt_instructions != ""
        assert "<persona>" in agent.compact_prompt_instructions
        assert "</persona>" in agent.compact_prompt_instructions

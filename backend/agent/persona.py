"""
Agent definitions — derived from the formal AgentRegistry.

Keeps the PUBLIC_PROMPTS and PUBLIC_LIST exports for backward compatibility
with agent/prompt.py and agent/main.py endpoints.
"""

from agent.registry import AGENT_REGISTRY, AGENT_PROMPTS

# Re-export for backward compatibility with prompt.py
PUBLIC_PROMPTS: dict[str, str] = AGENT_PROMPTS

# Build the API-facing persona list from the registry
PUBLIC_LIST: list[dict[str, str]] = [
    {
        "id": config.identifier,
        "name": config.display_name,
        "description": config.description,
        "compact_prompt_instructions": config.compact_prompt_instructions,
    }
    for config in AGENT_REGISTRY.list_agents()
]

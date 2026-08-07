"""
Formal agent configuration registry.

Each agent declares its identifier, prompt template instructions,
description, and list of bound tools. The registry replaces the ad-hoc
PERSONA_PROMPTS dictionary and is the single source of truth for agent
definitions used by the prompt builder, graph nodes, and API.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AgentConfig:
    """Configuration for a single agent in the registry."""

    identifier: str
    display_name: str
    description: str
    prompt_instructions: str
    compact_prompt_instructions: str = ""
    tool_names: list[str] = field(default_factory=lambda: [
        "run_python_code",
        "web_search",
        "save_user_memory",
        "delete_user_memory",
        "send_status_message",
        "webview_browser",
    ])


class AgentRegistry:
    """Mapping of agent identifiers to their configuration."""

    def __init__(self) -> None:
        self._agents: dict[str, AgentConfig] = {}

    def register(self, config: AgentConfig) -> None:
        """Register an agent configuration."""
        self._agents[config.identifier] = config

    def get(self, identifier: str) -> Optional[AgentConfig]:
        """Look up an agent by identifier. Returns None if not found."""
        return self._agents.get(identifier)

    def list_agents(self) -> list[AgentConfig]:
        """Return all registered agent configurations."""
        return list(self._agents.values())

    def get_tool_names(self, identifier: str) -> list[str]:
        """Return the tool names allowed for the given agent."""
        config = self.get(identifier)
        return config.tool_names if config else []


# ---------------------------------------------------------------------------
# Agent prompt templates
# ---------------------------------------------------------------------------

AGENT_PROMPTS: dict[str, str] = {
    "personal assistant": "",
    "teacher": """
<persona_instructions>
Identity/Role: You are a friendly, encouraging, and knowledgeable Teacher.
Voice & Tone: Patient, warm, supportive, and pedagogical. Use relatable analogies and clear, step-by-step explanations.
Guidelines:
1. Simplify complex technical terms or concepts. Explain them clearly as if explaining to a student.
2. Provide concrete, illustrative examples for abstract concepts.
3. At the end of the explanation, ask a supportive guiding question to check understanding or prompt further discussion.
4. Encourage learning and critical thinking.
</persona_instructions>
""",
    "analyst": """
<persona_instructions>
Identity/Role: You are a sharp, logical, and detail-oriented Analyst.
Voice & Tone: Objective, precise, structured, data-driven, and highly analytical.
Guidelines:
1. Break down user requests or problems into structured components (e.g., pros/cons, metrics, risks, key variables).
2. Focus on facts, evidence, data, trends, and business or technical logic.
3. Offer objective recommendations and highlight potential trade-offs or risks.
4. Avoid fluff and keep findings highly structured with bullet points or tables.
</persona_instructions>
""",
    "prompt builder": """
<persona_instructions>
Identity/Role: You are an adaptive, authentic AI collaborator and knowledgeable peer specializing in crafting system prompts for AI agents.
Voice & Tone: Warm, approachable, and direct. Balance empathy with candor—validate frustrations or efforts, but explain concepts clearly without sounding like a rigid lecturer or using conversational fluff.
Guidelines:
1. Help the user design, refine, and structure system prompts for various AI agents or tasks.
2. Outline clear role definitions, formatting rules, tool integration details, guardrails, and evaluation criteria for prompts.
3. Provide practical, high-quality examples of both valid/good and invalid/bad prompt configurations.
4. Keep instructions highly actionable, avoiding vague words like "think carefully".
</persona_instructions>
""",
    "google_workspace": """
<persona_instructions>
Identity/Role: You are a Google Workspace automation specialist integrated with Gmail, Google Calendar, and Google Drive.
Voice & Tone: Efficient, precise, and action-oriented. Focus on getting things done with Google tools.
Guidelines:
1. Help users manage their email, calendar events, and Drive files through natural conversation.
2. When users ask about scheduling, offer to check their calendar and find available slots.
3. For email tasks, assist with drafting, searching, and organizing messages.
4. Maintain awareness of Google Workspace limitations and scope — inform users if a request requires capabilities beyond what's currently available.
</persona_instructions>
""",
}

# ---------------------------------------------------------------------------
# Compact agent prompts for on-device context construction
# ---------------------------------------------------------------------------
COMPACT_PROMPTS: dict[str, str] = {
    "personal assistant": """<persona>
<role>Vela, an adaptive, authentic personal assistant and knowledgeable peer.</role>
<tone>Warm, approachable, direct. Balanced empathy and candor. Avoid generic filler (e.g. NEVER open with "Great question!").</tone>
<guidelines>
1. Mirror user technical depth; respond accessibly.
2. Prioritize concise, high-density responses (mobile-friendly).
3. Give direct answers first, then add essential nuance.
</guidelines>
</persona>""",
    "teacher": """<persona>
<role>Encouraging, patient, and pedagogical Teacher guide.</role>
<tone>Patient, warm, supportive, explaining concepts simply.</tone>
<guidelines>
1. Simplify complex terms using relatable analogies as if explaining to a student.
2. Provide concrete, illustrative examples for abstract concepts.
3. End explanations with a supportive guiding question to check understanding and prompt discussion.
</guidelines>
</persona>""",
    "analyst": """<persona>
<role>Sharp, logical, and detail-oriented Analyst.</role>
<tone>Objective, precise, structured, and data-driven.</tone>
<guidelines>
1. Break down requests into structured components: pros/cons, metrics, risks, and trade-offs.
2. Focus strictly on facts, evidence, and logical arguments.
3. Present findings in highly structured bullet points or clean tables without conversational fluff.
</guidelines>
</persona>""",
    "prompt builder": """<persona>
<role>Adaptive, authentic collaborator specializing in crafting system prompts.</role>
<tone>Warm, approachably direct. Balance empathy and candor without rigid lecturing.</tone>
<guidelines>
1. Outline clear role definitions, formatting rules, tool integrations, and evaluation criteria.
2. Provide high-quality examples of both good/valid and bad/invalid prompt configurations.
3. Keep instructions strictly actionable, avoiding vague advice like "think carefully".
</guidelines>
</persona>""",
    "google_workspace": """<persona>
<role>Google Workspace automation specialist (Gmail, Calendar, Drive).</role>
<tone>Efficient, precise, action-oriented, and helpful.</tone>
<guidelines>
1. Help users manage email, calendar events, and files through natural flow.
2. Proactively offer to check calendar slots and find availability.
3. Assist in searching, drafting, and organizing Gmail messages.
4. Call out scope limitations when a request exceeds capabilities.
</guidelines>
</persona>"""
}

# ---------------------------------------------------------------------------
# Build the registry singleton
# ---------------------------------------------------------------------------

_registry = AgentRegistry()

_registry.register(AgentConfig(
    identifier="personal assistant",
    display_name="Personal Assistant",
    description="Warm, approachable, and direct general assistant.",
    prompt_instructions=AGENT_PROMPTS["personal assistant"],
    compact_prompt_instructions=COMPACT_PROMPTS["personal assistant"],
))

_registry.register(AgentConfig(
    identifier="teacher",
    display_name="Teacher",
    description="Patient, encouraging pedagogical guide that explains concepts clearly.",
    prompt_instructions=AGENT_PROMPTS["teacher"],
    compact_prompt_instructions=COMPACT_PROMPTS["teacher"],
))

_registry.register(AgentConfig(
    identifier="analyst",
    display_name="Analyst",
    description="Structured, logical, data-driven analyst focusing on facts and risk assessment.",
    prompt_instructions=AGENT_PROMPTS["analyst"],
    compact_prompt_instructions=COMPACT_PROMPTS["analyst"],
))

_registry.register(AgentConfig(
    identifier="prompt builder",
    display_name="Prompt Builder",
    description="Specialized assistant designed to help craft, structure, and refine AI agent prompts.",
    prompt_instructions=AGENT_PROMPTS["prompt builder"],
    compact_prompt_instructions=COMPACT_PROMPTS["prompt builder"],
))

_registry.register(AgentConfig(
    identifier="google_workspace",
    display_name="Google Workspace",
    description="Gmail, Calendar, and Drive automation specialist.",
    prompt_instructions=AGENT_PROMPTS["google_workspace"],
    compact_prompt_instructions=COMPACT_PROMPTS["google_workspace"],
    tool_names=[
        "web_search",
        "save_user_memory",
        "delete_user_memory",
        "send_status_message",
        "gmail_send_email",
        "gmail_read_emails",
        "calendar_list_events",
        "calendar_create_event",
    ],
))

# Public singleton — import this wherever agent config is needed
AGENT_REGISTRY: AgentRegistry = _registry

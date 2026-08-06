from skills.base import BaseSkill

class MermaidGraphSkill(BaseSkill):
    def __init__(self):
        super().__init__()

    @property
    def name(self) -> str:
        return "MermaidGraphSkill"

    @property
    def description(self) -> str:
        return "Generate Mermaid diagrams to visually explain architectures, workflows, data flows, sequences, state machines, entity relationships, or any concept that benefits from a visual representation. Use when the user asks for a diagram, graph, flowchart, visualization, or when a visual would significantly improve understanding of the topic being discussed."

    async def execute(self, state: dict) -> str:
        return """### Mermaid Graph Generation

Generate clear, well-structured Mermaid diagrams to visually communicate concepts, architectures, workflows, and relationships.

#### Supported Diagram Types
Choose the most appropriate type for the context:
- **flowchart** (TD/LR) — processes, decision trees, workflows
- **sequenceDiagram** — API calls, request lifecycles, component interactions
- **classDiagram** — data models, entity relationships, class hierarchies
- **stateDiagram-v2** — state machines, lifecycle transitions, status flows
- **erDiagram** — database schemas, entity relationships
- **gantt** — timelines, project plans, schedules
- **graph** — dependency graphs, architecture overviews
- **pie** — proportional breakdowns
- **mindmap** — brainstorming, topic exploration, concept maps
- **gitgraph** — branching strategies, release flows

#### Rules
- Wrap every diagram in a ```mermaid code fence
- Use descriptive node labels, not single letters
- Keep diagrams focused — split complex systems into multiple diagrams rather than one cluttered graph
- Add subgraphs to group related components
- Use notes and annotations for additional context
- Use consistent direction (TD for hierarchies, LR for flows)
- Style critical paths or error flows with different line styles when it aids clarity
- If the user's question can be partially or fully answered with a diagram, include one proactively
- Pair each diagram with a brief textual explanation of what it shows

#### When to Generate Diagrams Proactively
Generate a Mermaid diagram without being asked when:
- Explaining system architecture or component relationships
- Describing a multi-step process or workflow
- Discussing state transitions or lifecycles
- Comparing branching strategies or deployment flows
- Answering questions where spatial/relational understanding matters"""

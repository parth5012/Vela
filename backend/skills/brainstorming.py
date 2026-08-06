from skills.base import BaseSkill

class BrainstormingSkill(BaseSkill):
    def __init__(self):
        super().__init__()

    @property
    def name(self) -> str:
        return "BrainstormingSkill"

    @property
    def description(self, ):
        return """You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."""
    async def execute(self, state: dict) -> str:
        return """ ### Brainstorming Ideas Into Designs
        Help turn ideas into fully formed designs and specs through natural collaborative dialogue.
        Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you’re building, present the design and get user approval.
        Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
        Anti-Pattern: “This Is Too Simple To Need A Design”
        Every project goes through this process. A todo list, a single-function utility, a config change — all of them. “Simple” projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.
        Checklist
        You MUST create a task for each of these items and complete them in order:
        Explore project context — check files, docs, recent commits
        Ask clarifying questions — one at a time, understand purpose/constraints/success criteria
        Propose 2-3 approaches — with trade-offs and your recommendation
        Present design — in sections scaled to their complexity, ask for  user approval after each section
        Spec self-review — quick inline check for placeholders, contradictions, ambiguity, scope (see below)
        Transition to implementation — invoke writing-plans skill to create implementation plan

        ### Key Principles
        One question at a time - Don’t overwhelm with multiple questions
        Multiple choice preferred - Easier to answer than open-ended when possible
        YAGNI ruthlessly - Remove unnecessary features from all designs
        Explore alternatives - Always propose 2-3 approaches before settling
        Incremental validation - Present design, get approval before moving on
        Be flexible - Go back and clarify when something doesn’t make sense."""

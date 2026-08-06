from skills.base import BaseSkill

class GrillMeSkill(BaseSkill):
    def __init__(self):
        super().__init__()

    @property
    def name(self) -> str:
        return "GrillMeSkill"

    @property
    def description(self) -> str:
        return "Interview the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases."
    
    async def execute(self, state: dict) -> str:
        print(f"Grilling: {state['query']}")
        return """Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.
        
        Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.
        
        If a question can be answered by exploring the codebase, explore the codebase instead."""

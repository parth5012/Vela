from skills.base import BaseSkill

class ResearchSkill(BaseSkill):
    @property
    def name(self) -> str:
        return "Research"

    @property
    def description(self) -> str:
        return "Research skill"

    async def execute(self, state: dict) -> str:
        pass

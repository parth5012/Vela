from skills.base import BaseSkill

class CodingSkill(BaseSkill):
    @property
    def name(self) -> str:
        return "Coding"

    @property
    def description(self) -> str:
        return "Coding skill"

    async def execute(self, state: dict) -> str:
        pass

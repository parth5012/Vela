from skills.coding import CodingSkill
from skills.research import ResearchSkill
from skills.brainstorming import BrainstormingSkill
from skills.grill_me import GrillMeSkill
from skills.mermaid_graphs import MermaidGraphSkill
from skills.checkin import CheckInSkill

skills = [
    # CodingSkill(),
    # ResearchSkill(),
    BrainstormingSkill(),
    GrillMeSkill(),
    MermaidGraphSkill(),
    CheckInSkill(),
]

__all__ = ["skills"]

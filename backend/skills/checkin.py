from skills.base import BaseSkill


class CheckInSkill(BaseSkill):
    def __init__(self):
        super().__init__()

    @property
    def name(self) -> str:
        return "CheckInSkill"

    @property
    def description(self) -> str:
        return "Guide the owner through a gentle daily check-in: mood, energy, one win, one thing being carried. Use when the user wants to check in, log their mood, or answer the daily check-in."

    async def execute(self, state: dict) -> str:
        return """### Daily Check-in

Guide the owner through a short daily check-in. Warm, kind, and zero-pressure — never clinical, never advice-giving.

#### Script (strict order, one question at a time)
Ask EXACTLY one question per turn and wait for the answer before continuing:
1. Mood — "How is your mood right now, 1-5?" (1 = very low, 5 = great)
2. Energy — "And your energy, 1-5?"
3. Win — "What is one win from today, however small?"
4. Carrying — "What is one thing you are carrying right now?"

Rules:
- One question at a time. Never batch two questions in one message.
- No unsolicited advice, analysis, or commentary on the answers.
- Accept free-text answers; map clear mood/energy words to 1-5 silently (e.g. "great" = 5, "okay" = 3, "awful" = 1). If unmappable, ask once for a number.
- The user may skip any step by saying "skip".

#### Completion contract
After step 4 is answered or skipped, end your reply with EXACTLY one JSON line (no code fences, nothing after it) using these exact field names:
{"mood": <1-5 int or null>, "energy": <1-5 int or null>, "win": <string or null>, "carrying": <string or null>, "note": <string or null>}
Use null for skipped or unanswered fields. Never emit more than one JSON line.

#### Memory
Do not call memory tools yourself. The backend distills the win, carrying, and note facts into semantic memory on save; numeric-only scores stay local.

#### Safety fallback (hard rule)
If the user expresses distress, self-harm, or crisis signals at ANY point:
- Stop the script immediately. Do not ask the next check-in question.
- Do not save anything and do not emit the JSON line.
- Reply with a brief, caring message encouraging them to contact a trusted person or their local emergency services right now.
- Never invent, guess, or fabricate hotline numbers or crisis resources."""

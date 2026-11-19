from datetime import datetime, timezone
from utils.llm import get_llm
from langsmith import traceable


def to_naive_utc(dt_or_iso: datetime | str | None) -> datetime | None:
    """Normalize a datetime object or ISO-8601 string to a timezone-naive UTC datetime.

    Google Credentials.expired internally compares self.expiry with datetime.datetime.utcnow(),
    which is offset-naive. If self.expiry is offset-aware, Python raises TypeError.
    This helper guarantees that any aware datetime/string is converted to UTC and stripped of tzinfo.
    """
    if dt_or_iso is None:
        return None
    if isinstance(dt_or_iso, str):
        val = dt_or_iso.strip()
        if not val:
            return None
        val = val.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(val)
        except (ValueError, TypeError):
            return None
    elif isinstance(dt_or_iso, datetime):
        dt = dt_or_iso
    else:
        return None

    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt

@traceable(name='Title Generation')
def get_title(conversation:str):
    import os
    google_api_key = os.getenv("GOOGLE_API_KEY", "")
    if not google_api_key or google_api_key.startswith("your_"):
        class MockResponse:
            content = "Mock Title"
        return MockResponse()
    try:
        return get_llm().invoke("Return the Title for this conversation below , do not generate any other word except for the title no preamble : \n Conversation \n" + conversation)
    except Exception:
        class MockResponse:
            content = "Mock Title"
        return MockResponse()

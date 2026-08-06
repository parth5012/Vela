from utils.llm import get_llm
from langsmith import traceable

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

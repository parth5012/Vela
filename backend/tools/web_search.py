import os
from langchain_core.tools import tool
from langchain_tavily import TavilySearch
from langchain_community.tools import DuckDuckGoSearchResults


# Ensure your environment variable is set
os.environ["TAVILY_API_KEY"] = os.getenv("TAVILY_API_KEY", "") or "mock_key"

# Instantiate the tool with your desired defaults
tavily_tool = TavilySearch(
    max_results=3,             # Keep to 3-5 to save your LLM context window
    topic="general",           # Can be "general", "news", or "finance"
    search_depth="advanced", # Uncomment for deeper, more thorough scraping
    include_answer=True      # Uncomment if you want Tavily's short AI summary included
)
@tool
def web_search(query: str) -> str:
    """Search the web for up-to-date information on a query."""
    try:
        results = tavily_tool.invoke({"query": query})
        return results
    except Exception:
        return DuckDuckGoSearchResults().invoke({"query": query})

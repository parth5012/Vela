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
    try:
        results = tavily_tool.invoke({"query": query})
        return results
    except Exception:
        return DuckDuckGoSearchResults().invoke({"query": query})

# @tool
# def search_tavily(query: str) -> str:
#     """Searches the web using the Tavily Search API and returns a synthesized text answer.
    
#     Use this tool when:
#     - The query requires up-to-date facts, current events, or news (remember the current year is 2026).
#     - Verifying facts, entities, or information not present in your static training data.
    
#     Do NOT use this tool when:
#     - Resolving logical reasoning, writing code, or performing math (use code execution instead).
#     - The user is asking conversational questions or discussing context already provided.
    
#     Args:
#         query: The search query string. Keep it concise and keyword-focused.
        
#     Returns:
#         A string containing the search results or direct answer.
#     """
#     api_key = os.getenv("TAVILY_API_KEY", "")
#     if not api_key:
#         return f"Mock search results for query: '{query}'"
    
#     try:
#         url = "https://api.tavily.com/search"
#         payload = {"api_key": api_key, "query": query, "include_answer": True}
#         response = httpx.post(url, json=payload, timeout=10.0)
#         response.raise_for_status()
#         return response.json().get("answer", "No direct answer found.")
#     except Exception as e:
#         return f"Search failed: {str(e)}"

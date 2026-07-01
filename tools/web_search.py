import os
import httpx

def search_tavily(query: str) -> str:
    api_key = os.getenv("TAVILY_API_KEY", "")
    if not api_key:
        return f"Mock search results for query: '{query}'"
    
    try:
        url = "https://api.tavily.com/search"
        payload = {"api_key": api_key, "query": query, "include_answer": True}
        response = httpx.post(url, json=payload, timeout=10.0)
        response.raise_for_status()
        return response.json().get("answer", "No direct answer found.")
    except Exception as e:
        return f"Search failed: {str(e)}"

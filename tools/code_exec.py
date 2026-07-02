import os
import httpx
from langchain_core.tools import tool

@tool
def run_python_code(code: str) -> str:
    api_key = os.getenv("E2B_API_KEY", "")
    if not api_key:
        return f"Mock execution output for code: {code[:30]}..."
        
    try:
        # Simplistic wrapper mock targeting code execution sandbox
        return f"Sandbox execution output for code run: Success."
    except Exception as e:
        return f"Execution error: {str(e)}"

# Tools and Modules Docstrings Design

## 1. Context
We need to add clear, detailed, and structured docstrings to the tools and database/cron modules in the project. For LangChain tools, the docstrings are critical because they serve as the prompt description that the LLM reads to determine when to call each tool.

## 2. Proposed Changes

### 2.1 Tool Docstrings
- Update `tools/code_exec.py` (`run_python_code`) to include execution details and constraints (e.g., when to run code vs. when not to).
- Update `tools/web_search.py` (`search_tavily`) to include search details and temporal instructions (e.g. current year 2026).

### 2.2 Database and Cron Docstrings
- Add docstrings to the `DBClient` class and its methods in `db/client.py`.
- Add docstrings to `cron/consolidate.py`.

## 3. Detailed Design

### 3.1 `tools/code_exec.py`
```python
def run_python_code(code: str) -> str:
    """Executes a Python code block in a sandboxed, secure environment and returns the stdout/stderr.
    
    Use this tool when:
    - Resolving mathematical equations or complex calculations.
    - Testing Python code logic or verifying coding puzzle outputs.
    - Performing data manipulation or algorithmic validation.
    
    Do NOT use this tool when:
    - The user simply asks you to write code without needing to see it run.
    - The question is conceptual and does not benefit from code execution.
    
    Args:
        code: A valid string containing the Python code block to execute.
        
    Returns:
        A string containing the stdout/stderr of the execution or the error message.
    """
```

### 3.2 `tools/web_search.py`
```python
def search_tavily(query: str) -> str:
    """Searches the web using the Tavily Search API and returns a synthesized text answer.
    
    Use this tool when:
    - The query requires up-to-date facts, current events, or news (remember the current year is 2026).
    - Verifying facts, entities, or information not present in your static training data.
    
    Do NOT use this tool when:
    - Resolving logical reasoning, writing code, or performing math (use code execution instead).
    - The user is asking conversational questions or discussing context already provided.
    
    Args:
        query: The search query string. Keep it concise and keyword-focused.
        
    Returns:
        A string containing the search results or direct answer.
    """
```

## 4. Verification Plan
- Run the full test suite (`pytest`) to verify that the docstring changes do not affect LangChain tool parsing or existing unit tests.

# Tools and Modules Docstrings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add detailed and descriptive docstrings with agent constraints to the LangChain tools, DB client modules, and the consolidation cron script.

**Architecture:** Inject docstrings to explain inputs, outputs, and model-level constraints/usage rules.

**Tech Stack:** Python docstrings.

---

### Task 1: Add Docstrings to LangChain Tools

**Files:**
- Modify: `tools/code_exec.py`
- Modify: `tools/web_search.py`

- [ ] **Step 1: Update `tools/code_exec.py`**
  Add the designed docstring to the `run_python_code` function:
  ```python
  @tool
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

- [ ] **Step 2: Update `tools/web_search.py`**
  Add the designed docstring to the `search_tavily` function:
  ```python
  @tool
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

- [ ] **Step 3: Run pytest to verify all tests still pass**
  Run: `pytest -v`
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add tools/code_exec.py tools/web_search.py
  git commit -m "docs: add detailed docstrings to tools"
  ```

---

### Task 2: Add Docstrings to DB Modules and Cron Scripts

**Files:**
- Modify: `db/client.py`
- Modify: `db/session.py`
- Modify: `cron/consolidate.py`

- [ ] **Step 1: Add docstrings to `db/client.py`**
  Add class-level and method-level docstrings to `DBClient`.

- [ ] **Step 2: Add docstrings to `db/session.py`**
  Add module-level docstrings and connection pool context.

- [ ] **Step 3: Add docstrings to `cron/consolidate.py`**
  Add function docstring explaining the consolidation process.

- [ ] **Step 4: Run pytest to verify all tests still pass**
  Run: `pytest -v`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add db/client.py db/session.py cron/consolidate.py
  git commit -m "docs: add docstrings to database and consolidation cron modules"
  ```

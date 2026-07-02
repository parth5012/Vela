# Tool-Based Long-Term Semantic Memory Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create explicit `@tool` decorated functions `save_user_memory` and `delete_user_memory` to give the LLM direct control over saving and updating user facts/preferences, inject the active conversation ID into the prompt, and clean up the background extraction thread.

**Architecture:** Expose memory operations as LangChain tools, allowing the agent to call them when the user shares personal details.

---

### Task 1: Create Memory Tools File

**Files:**
- Create: `tools/memory.py`
- Test: `tests/test_tools.py`

- [ ] **Step 1: Write `tools/memory.py`**
  Implement `save_user_memory` and `delete_user_memory` tools with embedding generation and LLM reconciliation logic.

- [ ] **Step 2: Update `tools/__init__.py`**
  Import and add the two new tools to the `tools_list`.

- [ ] **Step 3: Add unit tests to `tests/test_tools.py`**
  Add mock tests verifying `save_user_memory` and `delete_user_memory` logic and assertions.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_tools.py -v`
  Expected: PASS

---

### Task 2: Update Prompt Injection & Graph in `agent/graph.py`

**Files:**
- Modify: `agent/graph.py`
- Test: `tests/test_graph.py`

- [ ] **Step 1: Modify `agent/graph.py`**
  - Inject the active `db_conv_id` into the system prompt returned by `build_system_prompt`.
  - Remove the background thread call to `process_memory_extraction` inside `chatbot_node`.
  - Delete `process_memory_extraction` function to clean up dead code.

- [ ] **Step 2: Run pytest to verify all tests still pass**
  Run: `pytest -v`
  Expected: ALL PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tools/memory.py tools/__init__.py tests/test_tools.py agent/graph.py
  git commit -m "feat: implement tool-based long-term semantic memory management"
  ```

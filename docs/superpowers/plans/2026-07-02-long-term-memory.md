# Long-Term Semantic Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement long-term semantic memory in LangGraph by extracting personal facts and preferences from conversation messages, generating 768-dimensional embeddings via GoogleGenerativeAIEmbeddings, storing them in pgvector (`memory_vectors`), matching and resolving duplicates/updates, and retrieving them during active dialogue.

**Architecture:** Use a background execution thread in `chatbot_node` to handle fact extraction, similarity lookup, and conflict reconciliation asynchronously. Query vector database in `build_context` synchronously before constructing system prompts.

---

### Task 1: Implement Memory Retrieval in `build_context`

**Files:**
- Modify: `agent/graph.py`
- Test: `tests/test_graph.py`

- [ ] **Step 1: Write the failing test**
  Add a test `test_build_context_retrieves_memories` in `tests/test_graph.py` that mocks `GoogleGenerativeAIEmbeddings` and database results to verify context retrieval returns matched memories.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_graph.py -k test_build_context_retrieves_memories -v`
  Expected: FAIL

- [ ] **Step 3: Implement `build_context` logic**
  Update `agent/graph.py` to import `GoogleGenerativeAIEmbeddings` and `MemoryVector`. Implement the query logic in `build_context(state)` using SQLAlchemy cosine distance ordering.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_graph.py -k test_build_context_retrieves_memories -v`
  Expected: PASS

---

### Task 2: Implement Memory Extraction, Deduplication & Storage

**Files:**
- Modify: `agent/graph.py`
- Test: `tests/test_graph.py`

- [ ] **Step 1: Write the failing test**
  Add a test `test_memory_extraction_and_reconciliation` in `tests/test_graph.py` that calls memory extraction directly (synchronously for testing) and verifies insertion, update, and conflict resolution work correctly.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_graph.py -k test_memory_extraction_and_reconciliation -v`
  Expected: FAIL

- [ ] **Step 3: Implement extraction and reconciliation logic**
  Implement the `process_memory_extraction` helper function and trigger it inside `chatbot_node` using `threading.Thread`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_graph.py -k test_memory_extraction_and_reconciliation -v`
  Expected: PASS

- [ ] **Step 5: Run full project test suite**
  Run: `pytest -v`
  Expected: ALL PASS

- [ ] **Step 6: Commit**
  ```bash
  git add agent/graph.py tests/test_graph.py
  git commit -m "feat: implement long-term semantic memory retrieval and extraction"
  ```

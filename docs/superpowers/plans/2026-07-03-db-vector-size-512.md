# Migrate DB Vector Size to 512 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the pgvector embedding dimension size from 768 to 512 across the database schema, SQLAlchemy ORM models, and unit tests to align with 512-dimensional Gemini embeddings.

**Architecture:**
1. Recreate the database table `memory_vectors` with vector size 512.
2. Update the SQL schema script `db/schema.sql`.
3. Update the SQLAlchemy models in `db/models.py`.
4. Update vector mocks and assertions in the unit tests (`tests/test_graph.py`, `tests/test_llm_fallback.py`, and `tests/test_tools.py`).

**Tech Stack:** Python, SQLAlchemy, PostgreSQL, pgvector, pytest

---

### Task 1: Update SQL Schema and Database Table

**Files:**
- Modify: `db/schema.sql:22`

- [ ] **Step 1: Update schema.sql definition**
  Change the column `embedding` in the `memory_vectors` table in `db/schema.sql` to specify `VECTOR(512)` instead of `VECTOR(768)` (around line 22).

- [ ] **Step 2: Commit schema.sql changes**
  ```bash
  git add db/schema.sql
  git commit -m "db: update memory_vectors embedding vector size to 512 in schema.sql"
  ```

---

### Task 2: Update SQLAlchemy Models

**Files:**
- Modify: `db/models.py:33`

- [ ] **Step 1: Update models.py definition**
  Change the `vector` column type of `MemoryVector` to `Vector(512)` instead of `Vector(768)` (around line 33).

- [ ] **Step 2: Commit models.py changes**
  ```bash
  git add db/models.py
  git commit -m "db: update MemoryVector ORM embedding model to Vector(512)"
  ```

---

### Task 3: Update LLM Fallback Unit Tests

**Files:**
- Modify: `tests/test_llm_fallback.py:46-51`

- [ ] **Step 1: Update mock vector size**
  In `tests/test_llm_fallback.py`, change mock return value vector list length from `768` to `512` (around lines 46 & 51).

- [ ] **Step 2: Run the test to verify it passes**
  ```bash
  uv run python -m pytest tests/test_llm_fallback.py -v
  ```
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/test_llm_fallback.py
  git commit -m "test: update vector dimensions in test_llm_fallback.py"
  ```

---

### Task 4: Update Graph Unit Tests

**Files:**
- Modify: `tests/test_graph.py:73-80`

- [ ] **Step 1: Update mock vector size**
  In `tests/test_graph.py`, change mock returned and constructed vector list length from `768` to `512` (around lines 73 & 80).

- [ ] **Step 2: Run the test to verify it passes**
  ```bash
  uv run python -m pytest tests/test_graph.py -v
  ```
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/test_graph.py
  git commit -m "test: update vector dimensions in test_graph.py"
  ```

---

### Task 5: Update Tools Unit Tests

**Files:**
- Modify: `tests/test_tools.py:30-56`

- [ ] **Step 1: Update mock vector size**
  In `tests/test_tools.py`, change mock returned and constructed vector list length from `768` to `512` (around lines 30, 51, & 56).

- [ ] **Step 2: Run the test to verify it passes**
  ```bash
  uv run python -m pytest tests/test_tools.py -v
  ```
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add tests/test_tools.py
  git commit -m "test: update vector dimensions in test_tools.py"
  ```

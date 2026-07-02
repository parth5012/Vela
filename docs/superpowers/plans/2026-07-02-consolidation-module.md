# Self-Improvement Consolidation Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement dynamic prompt fragment loading in `agent/graph.py` and implement the `/consolidate` self-improvement cron logic in `cron/consolidate.py` using `ChatGoogleGenerativeAI`.

**Architecture:** Load `dynamic_rules` from the `system_prompt_fragments` table in the database and append them to the system prompt in `agent/graph.py`. Fetch unconsolidated experiences in `cron/consolidate.py`, package them into an LLM analysis prompt, save the updated guidelines as `dynamic_rules`, and mark processed experiences consolidated.

**Tech Stack:** SQLAlchemy 2.0, LangChain / LangChain Google GenAI, FastAPI.

---

### Task 1: Dynamic Prompt Loading in `agent/graph.py`

**Files:**
- Modify: `agent/graph.py`
- Test: `tests/test_graph.py`

- [ ] **Step 1: Write the failing test**
  Add a test in `tests/test_graph.py` to verify that `build_system_prompt` queries the database for prompt fragments and inserts them.
  Wait, let's view `tests/test_graph.py` first to see its current implementation.
  Let's see if we should write a test that mocks `get_db_session` and inserts a dummy dynamic rule, then asserts that rule is in the system prompt.
  ```python
  from unittest.mock import patch, MagicMock
  from agent.graph import build_system_prompt, AgentState
  from db.models import SystemPromptFragment

  @patch("agent.graph.get_db_session")
  def test_build_system_prompt_injects_dynamic_rules(mock_get_db):
      # Set up mock DB session returning a mock fragment
      mock_session = MagicMock()
      mock_fragment = SystemPromptFragment(key="dynamic_rules", content="* Must be concise and funny.")
      mock_session.query().filter_by().first.return_value = mock_fragment
      mock_get_db.return_value.__enter__.return_value = mock_session

      state: AgentState = {
          "messages": [],
          "telegram_chat_id": 12345,
          "db_conv_id": "conv-123",
          "relevant_memories": [],
          "next_node": ""
      }
      prompt = build_system_prompt(state)
      assert "* Must be concise and funny." in prompt
      assert "# Dynamic Rules" in prompt
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_graph.py -k test_build_system_prompt_injects_dynamic_rules -v`
  Expected: FAIL (either `get_db_session` is not imported/defined in `agent/graph.py`, or the dynamic rules are not injected).

- [ ] **Step 3: Modify `agent/graph.py` to load and inject dynamic rules**
  Import `get_db_session` and `SystemPromptFragment` in `agent/graph.py`.
  Update `build_system_prompt(state)` to query `dynamic_rules` and inject them:
  ```python
  from db.session import get_db_session
  from db.models import SystemPromptFragment

  # Inside build_system_prompt(state: AgentState) -> str:
      dynamic_rules_content = ""
      try:
          with get_db_session() as session:
              fragment = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
              if fragment and fragment.content:
                  dynamic_rules_content = f"\n\n# Dynamic Rules\n{fragment.content}"
      except Exception as e:
          # Fail-safe to default prompt if DB fails
          pass
  ```
  And inject `dynamic_rules_content` into the returned system prompt string.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_graph.py -k test_build_system_prompt_injects_dynamic_rules -v`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add agent/graph.py tests/test_graph.py
  git commit -m "feat: implement dynamic prompt loading in graph"
  ```

---

### Task 2: Implement Self-Improvement Loop in `cron/consolidate.py`

**Files:**
- Modify: `cron/consolidate.py`
- Test: `tests/test_cron.py`

- [ ] **Step 1: Write the failing test**
  Modify `tests/test_cron.py` to verify that when `/consolidate` is called, it processes unconsolidated experiences, calls the LLM, updates the prompt fragment, and marks experiences consolidated.
  ```python
  from unittest.mock import patch, MagicMock
  import pytest
  from fastapi.testclient import TestClient
  from agent.main import app
  from db.session import get_db_session
  from db.models import Experience, SystemPromptFragment

  client = TestClient(app)

  @patch("cron.consolidate.ChatGoogleGenerativeAI")
  def test_run_self_improvement_flow(mock_llm_class):
      # Set up mock LLM return value
      mock_llm = MagicMock()
      mock_llm.invoke.return_value.content = "* Always start responses with a friendly greeting."
      mock_llm_class.return_value = mock_llm

      with get_db_session() as session:
          # Clean tables first
          session.query(SystemPromptFragment).filter_by(key="dynamic_rules").delete()
          session.query(Experience).delete()
          session.commit()

          # Insert a dummy unconsolidated experience
          exp = Experience(
              id="test-exp-123",
              conversation_id="some-conv-uuid",
              user_query="How are you?",
              agent_response="I am fine.",
              eval_score=2.0,
              eval_reason="Too short and mechanical."
          )
          session.add(exp)
          session.commit()

      response = client.post("/consolidate")
      assert response.status_code == 200
      assert response.json()["status"] == "success"

      with get_db_session() as session:
          # Check experience is consolidated
          exp_after = session.query(Experience).filter_by(id="test-exp-123").first()
          assert exp_after.consolidated is True

          # Check dynamic rules were updated
          rules = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
          assert rules is not None
          assert "* Always start responses with a friendly greeting." in rules.content
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_cron.py -k test_run_self_improvement_flow -v`
  Expected: FAIL (since cron job only returns mock string and doesn't write to DB or call LLM).

- [ ] **Step 3: Implement consolidation logic**
  Update `cron/consolidate.py` to:
  1. Retrieve unconsolidated experiences from database using SQLAlchemy.
  2. Stop early if there are none.
  3. Format experiences into an evaluation block.
  4. Load the existing `dynamic_rules` fragment.
  5. Assemble a detailed prompt.
  6. Instantiate `ChatGoogleGenerativeAI` and call it.
  7. Save response to `system_prompt_fragments` (key `dynamic_rules`).
  8. Mark processed experiences as `consolidated = True`.
  ```python
  import os
  from datetime import datetime
  from db.session import get_db_session
  from db.models import Experience, SystemPromptFragment
  from langchain_google_genai import ChatGoogleGenerativeAI
  from utils.logger import StructuredLogger

  logger = StructuredLogger("ConsolidatedCron")

  def run_self_improvement() -> str:
      logger.info("Starting run_self_improvement nightly cron job")
      api_key = os.getenv("GOOGLE_API_KEY", "")
      if not api_key or api_key.startswith("your_"):
          logger.warning("GOOGLE_API_KEY is not set or is mock. Skipping consolidation.")
          return "Consolidation skipped: GOOGLE_API_KEY not configured."

      try:
          with get_db_session() as session:
              experiences = session.query(Experience).filter_by(consolidated=False).all()
              if not experiences:
                  msg = "Consolidated 0 experiences: No new experiences found."
                  logger.info(msg)
                  return msg

              # Format experiences
              experiences_block = ""
              for i, exp in enumerate(experiences):
                  experiences_block += (
                      f"Experience #{i+1}:\n"
                      f"- Query: {exp.user_query}\n"
                      f"- Response: {exp.agent_response}\n"
                      f"- Eval Score: {exp.eval_score}\n"
                      f"- Eval Reason: {exp.eval_reason}\n\n"
                  )

              # Get existing rules
              existing_rules = ""
              rules_fragment = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
              if rules_fragment:
                  existing_rules = rules_fragment.content

              # Build Prompt
              prompt = f"""You are a Supervisor Self-Improvement System. Your job is to analyze recent user interaction experiences, identify conversational or technical weaknesses, and update the existing dynamic rules.

  ### Input Data:
  1. **Existing Dynamic Rules**:
  {existing_rules if existing_rules else "(None)"}

  2. **Recent User Interaction Experiences (evaluated)**:
  {experiences_block}

  ### Instructions:
  - Analyze the experiences, focusing particularly on interactions with low evaluation scores.
  - Determine if the agent was too verbose, mathematically incorrect, ignored instructions, lacked empathy, or was pedantic.
  - Revise the "Existing Dynamic Rules" to introduce new constraints, guidelines, or style adjustments to prevent these mistakes.
  - Do NOT delete existing rules unless they conflict with new guidelines or are no longer useful.
  - Ensure the rules remain concise, clear, and action-oriented. Do not exceed 10 distinct guidelines.
  - Output ONLY the updated rules block. Do not include markdown preamble or conversational text outside of the rules format.
  """

              logger.info("Triggering LLM for prompt consolidation", num_experiences=len(experiences))
              llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=api_key)
              response = llm.invoke(prompt)
              updated_rules = response.content.strip()

              # Update database
              if not rules_fragment:
                  rules_fragment = SystemPromptFragment(key="dynamic_rules", content=updated_rules)
                  session.add(rules_fragment)
              else:
                  rules_fragment.content = updated_rules
                  rules_fragment.updated_at = datetime.utcnow()

              # Mark experiences as consolidated
              for exp in experiences:
                  exp.consolidated = True

              session.commit()
              msg = f"Consolidated {len(experiences)} experiences and updated dynamic_rules prompt fragment."
              logger.info(msg)
              return msg
      except Exception as e:
          logger.error("Failed executing run_self_improvement cron job", error=str(e))
          return f"Consolidation failed: {str(e)}"
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_cron.py -k test_run_self_improvement_flow -v`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add cron/consolidate.py tests/test_cron.py
  git commit -m "feat: implement consolidation self-improvement loop"
  ```

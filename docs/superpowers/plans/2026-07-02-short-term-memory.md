# Short-Term Conversation Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement short-term memory inside the LangGraph supervisor workflow by loading recent messages from the `experiences` table and appending them to the prompt context, logging new experiences back to the database, and wiring up `TelegramGateway` to load the actual conversation ID.

**Architecture:** Update `build_recent_messages` in `agent/graph.py` to load the last 5 experiences for the active `db_conv_id`. Update `chatbot_node` to save the new interaction to the `experiences` table. Update `TelegramGateway` to load the correct conversation ID from the database.

**Tech Stack:** SQLAlchemy 2.0, LangGraph, python-telegram-bot.

---

### Task 1: Update Telegram Gateway to Fetch Conversation ID

**Files:**
- Modify: `gateway/telegram.py`
- Modify: `agent/main.py`
- Test: `tests/test_telegram.py`

- [ ] **Step 1: Write the failing test**
  Update `tests/test_telegram.py` to verify `TelegramGateway` is instantiated with the database client and fetches the conversation ID instead of hardcoding `"conv-123"`.
  Let's view `tests/test_telegram.py` first to see its current implementation.
  *(We will read it in the next step, but let's draft the test change: mock `db.get_or_create_conversation` and assert it is called).*

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_telegram.py -v`
  Expected: FAIL (or verify the mismatch).

- [ ] **Step 3: Implement TelegramGateway database integration**
  Update `gateway/telegram.py`'s `__init__` to accept `db` and store it. Update `handle_update` to fetch `db_conv_id = self.db.get_or_create_conversation(chat_id)`.
  Update `agent/main.py` to initialize `telegram_gateway = TelegramGateway(db=db)`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_telegram.py -v`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add gateway/telegram.py agent/main.py tests/test_telegram.py
  git commit -m "feat: integrate database conversation lookup in TelegramGateway"
  ```

---

### Task 2: Implement Short-Term Memory Reading and Writing in `agent/graph.py`

**Files:**
- Modify: `agent/graph.py`
- Test: `tests/test_graph.py`

- [ ] **Step 1: Write the failing test**
  Add a test in `tests/test_graph.py` to verify that `build_recent_messages` pulls history from the database and formats it chronologically.
  ```python
  @patch("agent.graph.get_db_session")
  def test_build_recent_messages_loads_history(mock_get_db):
      mock_session = MagicMock()
      mock_exp = Experience(
          conversation_id="conv-123",
          user_query="Who are you?",
          agent_response="I am Vela.",
          created_at=datetime.utcnow()
      )
      mock_session.query().filter_by().order_by().limit().all.return_value = [mock_exp]
      mock_get_db.return_value.__enter__.return_value = mock_session

      state: AgentState = {
          "messages": [HumanMessage(content="What is my name?")],
          "telegram_chat_id": 123,
          "db_conv_id": "real-conv-uuid",
          "relevant_memories": [],
          "next_node": ""
      }
      history = build_recent_messages(state)
      assert "Human: Who are you?\nAI: I am Vela." in history
      assert "Human: What is my name?" in history
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_graph.py -k test_build_recent_messages_loads_history -v`
  Expected: FAIL

- [ ] **Step 3: Implement reading and writing logic in `agent/graph.py`**
  Modify `build_recent_messages` and `chatbot_node` to handle loading from and saving to the `experiences` table using SQLAlchemy.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/test_graph.py -k test_build_recent_messages_loads_history -v`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add agent/graph.py tests/test_graph.py
  git commit -m "feat: implement reading and writing of short-term memory in graph"
  ```

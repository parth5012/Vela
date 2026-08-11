# Vela Dynamic Skills Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement dynamic skills injection in the Vela AI assistant, allowing multi-turn cognitive agent skills (e.g. Brainstorming, Grilling) to be activated, continued, and deactivated based on user intent, with instructions dynamically injected into the system prompt.

**Architecture:** We will persist the active skill state in the PostgreSQL `conversations` table, classify skill transition intent in the LangGraph `supervisor_node`, and convert the prompt builder and chatbot nodes to run asynchronously to execute the active skill's prompt instructions and dynamically inject them into the system prompt instructions.

**Tech Stack:** Python, LangGraph, LangChain, SQLAlchemy, PostgreSQL (Supabase), Pytest

---

### Task 1: Database Model & Migration

**Files:**
- Modify: [db/schema.sql](file:///D:/work/projects/Vela/db/schema.sql)
- Modify: [db/models.py](file:///D:/work/projects/Vela/db/models.py)
- Modify: [db/client.py](file:///D:/work/projects/Vela/db/client.py)
- Modify: [agent/main.py](file:///D:/work/projects/Vela/agent/main.py)
- Test: [tests/test_client.py](file:///D:/work/projects/Vela/tests/test_client.py)

- [ ] **Step 1: Update schema.sql with active_skill column**
  Add the `active_skill` column to the `conversations` table definition in [db/schema.sql](file:///D:/work/projects/Vela/db/schema.sql).
  ```sql
  -- Add this line to the CREATE TABLE IF NOT EXISTS conversations query or append an ALTER TABLE statement at the end of the file.
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS active_skill VARCHAR(50) DEFAULT NULL;
  ```

- [ ] **Step 2: Update SQLAlchemy model in models.py**
  Add the `active_skill` field to the `Conversation` class in [db/models.py](file:///D:/work/projects/Vela/db/models.py):
  ```python
  # Around line 19
  active_skill = Column(String(50), nullable=True, default=None)
  ```

- [ ] **Step 3: Update DBClient with CRUD helper**
  Add `update_conversation_active_skill` method to `DBClient` in [db/client.py](file:///D:/work/projects/Vela/db/client.py):
  ```python
  def update_conversation_active_skill(self, conversation_id: str, active_skill: str | None) -> Conversation | None:
      """Updates the active skill of a specific conversation."""
      conv = self.session.query(Conversation).filter_by(id=conversation_id).first()
      if conv:
          conv.active_skill = active_skill
          conv.updated_at = datetime.now(UTC).replace(tzinfo=None)
          self.session.flush()
      return conv
  ```

- [ ] **Step 4: Update lifespan hook for auto-migration**
  Modify [agent/main.py](file:///D:/work/projects/Vela/agent/main.py)'s `lifespan` function to perform the migration if the column is missing:
  ```python
  @asynccontextmanager
  async def lifespan(app: FastAPI):
      # Run database migration (add persona and active_skill columns if missing)
      try:
          from db.session import engine
          from sqlalchemy import inspect
          inspector = inspect(engine)
          columns = [col['name'] for col in inspector.get_columns('conversations')]
          if 'persona' not in columns:
              logger.info("Database migration: adding 'persona' column to 'conversations' table")
              with engine.begin() as conn:
                  conn.execute("ALTER TABLE conversations ADD COLUMN persona VARCHAR(50) DEFAULT 'personal assistant' NOT NULL")
          if 'active_skill' not in columns:
              logger.info("Database migration: adding 'active_skill' column to 'conversations' table")
              with engine.begin() as conn:
                  conn.execute("ALTER TABLE conversations ADD COLUMN active_skill VARCHAR(50) DEFAULT NULL")
      except Exception as e:
          logger.error("Failed to run database migration for active_skill column", error=str(e))

      yield
  ```

- [ ] **Step 5: Write client unit test**
  Add a test to [tests/test_client.py](file:///D:/work/projects/Vela/tests/test_client.py) to verify retrieving and updating `active_skill`.
  ```python
  def test_update_conversation_active_skill(db_session):
      client = DBClient(db_session)
      conv = client.get_or_create_conversation(12345)
      assert conv.active_skill is None
      
      client.update_conversation_active_skill(conv.id, "BrainstormingSkill")
      db_session.commit()
      
      updated = db_session.query(Conversation).filter_by(id=conv.id).first()
      assert updated.active_skill == "BrainstormingSkill"
      
      client.update_conversation_active_skill(conv.id, None)
      db_session.commit()
      assert updated.active_skill is None
  ```

- [ ] **Step 6: Run tests to verify client database updates**
  Run: `$env:PYTHONPATH="."; pytest tests/test_client.py -v`
  Expected: PASS

- [ ] **Step 7: Commit database updates**
  Run:
  ```bash
  git add db/schema.sql db/models.py db/client.py agent/main.py tests/test_client.py
  git commit -m "feat: add active_skill to conversations table and CRUD helpers"
  ```

---

### Task 2: State Update & Async Prompts

**Files:**
- Modify: [agent/state.py](file:///D:/work/projects/Vela/agent/state.py)
- Modify: [agent/prompt.py](file:///D:/work/projects/Vela/agent/prompt.py)
- Test: [tests/test_graph.py](file:///D:/work/projects/Vela/tests/test_graph.py)

- [ ] **Step 1: Add active_skill to AgentState**
  Update `AgentState` in [agent/state.py](file:///D:/work/projects/Vela/agent/state.py):
  ```python
  class AgentState(TypedDict, total=False):
      messages: Annotated[Sequence[BaseMessage], add_messages]
      telegram_chat_id: int
      db_conv_id: str
      relevant_memories: list[str]
      next_node: str
      persona: Optional[str]
      skill_prompt: Optional[str]
      active_skill: Optional[str] # Add active_skill tracking
  ```

- [ ] **Step 2: Convert build_system_prompt to async and inject active skill**
  Modify [agent/prompt.py](file:///D:/work/projects/Vela/agent/prompt.py):
  1. Change `def build_system_prompt` to `async def build_system_prompt`.
  2. Retrieve the active skill using `state.get("active_skill")`, locate it in the registered list, execute it using `await skill_obj.execute(state)`, and append the result to `dynamic_rules_section`.
  ```python
  async def build_system_prompt(state: AgentState) -> str:
      context = build_context(state)
      recent_messages = build_recent_messages(state)
      db_conv_id = state.get("db_conv_id", "")
      chat_id = state.get("telegram_chat_id", 0)

      # Retrieve the persona (default to "personal assistant")
      persona = state.get("persona") or "personal assistant"
      if persona == "personal assistant" and db_conv_id and db_conv_id != "conv-123":
          try:
              with get_db_session() as session:
                  conv = session.query(Conversation).filter_by(id=db_conv_id).first()
                  if conv and conv.persona:
                      persona = conv.persona
          except Exception:
              pass

      persona_section = PERSONA_PROMPTS.get(persona, "")

      dynamic_rules_section = ""
      try:
          with get_db_session() as session:
              fragment = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
              if fragment and fragment.content:
                  dynamic_rules_section = f"\n\n# Dynamic Rules\n{fragment.content}\n"
      except Exception:
          pass

      if persona_section:
          dynamic_rules_section += f"\n{persona_section}"

      # Active Skill Dynamic Injection
      active_skill_prompt = ""
      active_skill_name = state.get("active_skill")
      if active_skill_name:
          from skills import skills
          skill_obj = next((s for s in skills if s.name == active_skill_name), None)
          if skill_obj:
              active_skill_prompt = await skill_obj.execute(state)

      if active_skill_prompt:
          dynamic_rules_section += f"\n\n# Active Skill Instructions\n{active_skill_prompt}\n"

      return MAIN_PROMPT.format(db_conv_id=db_conv_id, chat_id=chat_id, context=context, recent_messages=recent_messages, dynamic_rules_section=dynamic_rules_section)
  ```

- [ ] **Step 3: Convert unit tests for build_system_prompt to async**
  Modify [tests/test_graph.py](file:///D:/work/projects/Vela/tests/test_graph.py):
  1. Add `@pytest.mark.asyncio` decorator to `test_build_system_prompt_injects_dynamic_rules`.
  2. Change it to `async def` and use `await build_system_prompt(state)`.
  ```python
  @pytest.mark.asyncio
  @patch("agent.prompt.get_db_session")
  async def test_build_system_prompt_injects_dynamic_rules(mock_get_db):
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
      prompt = await build_system_prompt(state)
      assert "* Must be concise and funny." in prompt
      assert "# Dynamic Rules" in prompt
  ```

- [ ] **Step 4: Add unit test verifying active skill prompt injection**
  Add a test to [tests/test_graph.py](file:///D:/work/projects/Vela/tests/test_graph.py) verifying active skill instructions are injected into the system prompt:
  ```python
  @pytest.mark.asyncio
  @patch("agent.prompt.get_db_session")
  async def test_build_system_prompt_injects_active_skill(mock_get_db):
      mock_session = MagicMock()
      mock_session.query().filter_by().first.return_value = None
      mock_get_db.return_value.__enter__.return_value = mock_session

      state: AgentState = {
          "messages": [],
          "telegram_chat_id": 12345,
          "db_conv_id": "conv-123",
          "relevant_memories": [],
          "next_node": "",
          "active_skill": "BrainstormingSkill"
      }
      prompt = await build_system_prompt(state)
      assert "# Active Skill Instructions" in prompt
      assert "Brainstorming Ideas Into Designs" in prompt
  ```

- [ ] **Step 5: Run graph and prompt tests**
  Run: `$env:PYTHONPATH="."; pytest tests/test_graph.py -k "build_system_prompt" -v`
  Expected: PASS

- [ ] **Step 6: Commit state and prompt updates**
  Run:
  ```bash
  git add agent/state.py agent/prompt.py tests/test_graph.py
  git commit -m "feat: convert build_system_prompt to async and support dynamic skills injection"
  ```

---

### Task 3: Supervisor Intent Classification & Chatbot Conversion

**Files:**
- Modify: [agent/graph.py](file:///D:/work/projects/Vela/agent/graph.py)
- Test: [tests/test_graph.py](file:///D:/work/projects/Vela/tests/test_graph.py)

- [ ] **Step 1: Update supervisor_node to load, classify, and update active_skill**
  Modify the `supervisor_node` function in [agent/graph.py](file:///D:/work/projects/Vela/agent/graph.py) to:
  1. Load the current active skill from database.
  2. Format a system classification prompt containing the descriptions of registered skills.
  3. Query the LLM, asking for structured JSON representing `intent` and `skill_name`.
  4. Parse the response robustly, handling exceptions with fallback heuristic checks.
  5. Update the DB `active_skill` column when the state transition changes.
  6. Return `{"active_skill": resolved_skill, "next_node": "chatbot"}`.
  ```python
  @traceable(name='Supervisor')
  def supervisor_node(state: AgentState) -> dict:
      llm = get_llm()
      db_conv_id = state.get("db_conv_id")
      
      current_active_skill = None
      if db_conv_id and db_conv_id != "conv-123":
          try:
              with get_db_session() as session:
                  from db.models import Conversation
                  conv = session.query(Conversation).filter_by(id=db_conv_id).first()
                  if conv:
                      current_active_skill = conv.active_skill
          except Exception as e:
              logger.error("Failed to fetch active_skill from database", error=str(e))
              
      # List enabled skills
      from skills import skills
      skills_with_descriptions = "\n".join([f"- {s.name}: {s.description}" for s in skills])
      
      supervisor_prompt = f"""You are a supervisor that decides which skill to run next based on the user's message.
  Available skills:
  {skills_with_descriptions}

  Currently active skill: {current_active_skill or "None"}

  You must classify the user's intent into one of these actions:
  1. "activate": The user is explicitly asking to start or switch to a specific skill (e.g. "let's brainstorm", "grill me", or asking a question that fits a skill description).
  2. "deactivate": The user explicitly asks to stop, exit, or cancel the active skill (e.g. "exit", "stop", "cancel", "deactivate").
  3. "continue": A skill is currently active and the user is continuing the conversation under that skill, without asking to stop or switch.
  4. "none": No skill is currently active and the user is chatting normally without asking to activate one.

  Return ONLY a JSON object with this exact structure:
  {{
    "intent": "activate" | "deactivate" | "continue" | "none",
    "skill_name": "BrainstormingSkill" | "GrillMeSkill" | null
  }}

  Do not include markdown formatting or backticks around the JSON.
  """

      response = llm.invoke([SystemMessage(content=supervisor_prompt)] + list(state["messages"]))
      
      # Clean the response content
      content = response.content.strip()
      if content.startswith("```json"):
          content = content[7:]
      if content.endswith("```"):
          content = content[:-3]
      content = content.strip()
      
      intent = "none"
      skill_name = None
      try:
          import json
          data = json.loads(content)
          intent = data.get("intent", "none")
          skill_name = data.get("skill_name")
      except Exception as e:
          logger.error("Failed to parse supervisor classification", error=str(e), content=content)
          # Fallback heuristic: check if any skill name is mentioned or if they want to stop
          user_text = state["messages"][-1].content.lower() if state["messages"] else ""
          if "exit" in user_text or "stop" in user_text or "cancel" in user_text:
              intent = "deactivate"
          elif "brainstorm" in user_text:
              intent = "activate"
              skill_name = "BrainstormingSkill"
          elif "grill" in user_text:
              intent = "activate"
              skill_name = "GrillMeSkill"
          elif current_active_skill:
              intent = "continue"
              skill_name = current_active_skill
              
      # Resolve new active skill state
      new_active_skill = current_active_skill
      if intent == "activate" and skill_name:
          if any(s.name == skill_name for s in skills):
              new_active_skill = skill_name
      elif intent == "deactivate":
          new_active_skill = None
      elif intent == "none":
          new_active_skill = None
      elif intent == "continue":
          new_active_skill = current_active_skill
          
      # Update DB if it changed
      if db_conv_id and db_conv_id != "conv-123" and new_active_skill != current_active_skill:
          try:
              with get_db_session() as session:
                  from db.client import DBClient
                  client = DBClient(session)
                  client.update_conversation_active_skill(db_conv_id, new_active_skill)
                  session.commit()
          except Exception as e:
              logger.error("Failed to update active_skill in database", error=str(e))
              
      return {"active_skill": new_active_skill, "next_node": "chatbot"}
  ```

- [ ] **Step 2: Convert chatbot_node to async and support build_system_prompt**
  Modify `chatbot_node` in [agent/graph.py](file:///D:/work/projects/Vela/agent/graph.py) to be `async def` and await the prompt builder:
  ```python
  async def chatbot_node(state: AgentState) -> dict:
      api_key = os.getenv("GOOGLE_API_KEY", "")
      response_msg = None
      
      # Extract the user's human message from history
      user_msg = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
      user_message = user_msg.content if user_msg else ""
      
      if api_key and not api_key.startswith("your_"):
          try:
              llm = get_llm().bind_tools(tools_list)
              system_prompt = await build_system_prompt(state)
              response_msg = await llm.ainvoke([
                  SystemMessage(content=system_prompt)
              ] + list(state["messages"]))
          except Exception as e:
              response_msg = AIMessage(content=f"Error invoking LLM: {str(e)}")
      else:
          response_msg = AIMessage(content=f"Hello! I received your message: '{user_message}'. (Google API Key is not set, running in mock mode)")

      # Save the interaction to the experiences table in database
      db_conv_id = state.get("db_conv_id")
      is_tool_call = bool(getattr(response_msg, "tool_calls", None))
      if db_conv_id and db_conv_id != "conv-123" and not is_tool_call:
          try:
              with get_db_session() as session:
                  from db.client import DBClient
                  client = DBClient(session)
                  client.save_experience(
                      conversation_id=db_conv_id,
                      user_query=user_message,
                      agent_response=response_msg.content
                  )
                  session.commit()
          except Exception:
              pass

      return {"messages": [response_msg], "next_node": END}
  ```

- [ ] **Step 3: Update unit tests in test_graph.py to verify intent classification and routing**
  Update `test_supervisor_routing_to_end` in [tests/test_graph.py](file:///D:/work/projects/Vela/tests/test_graph.py) to mock the LLM and DB, and add test cases for routing under different user inputs (normal chat, activate, deactivate):
  ```python
  @pytest.mark.asyncio
  @patch("agent.graph.get_llm")
  @patch("agent.graph.get_db_session")
  async def test_supervisor_node_classification(mock_get_db, mock_get_llm):
      # Mock LLM response for activating BrainstormingSkill
      mock_llm = MagicMock()
      mock_response = MagicMock()
      mock_response.content = '{"intent": "activate", "skill_name": "BrainstormingSkill"}'
      mock_llm.invoke.return_value = mock_response
      mock_get_llm.return_value = mock_llm

      # Mock Database
      mock_session = MagicMock()
      mock_conv = MagicMock()
      mock_conv.active_skill = None
      mock_session.query().filter_by().first.return_value = mock_conv
      mock_get_db.return_value.__enter__.return_value = mock_session

      state: AgentState = {
          "messages": [HumanMessage(content="let's brainstorm")],
          "telegram_chat_id": 999,
          "db_conv_id": "conv-999",
          "relevant_memories": [],
          "next_node": ""
      }

      from agent.graph import supervisor_node
      result = supervisor_node(state)
      assert result["active_skill"] == "BrainstormingSkill"
      assert result["next_node"] == "chatbot"
  ```

- [ ] **Step 4: Run all pytest tests**
  Run: `$env:PYTHONPATH="."; pytest -v`
  Expected: PASS

- [ ] **Step 5: Commit supervisor and chatbot node updates**
  Run:
  ```bash
  git add agent/graph.py tests/test_graph.py
  git commit -m "feat: implement supervisor intent classification and convert chatbot to async"
  ```

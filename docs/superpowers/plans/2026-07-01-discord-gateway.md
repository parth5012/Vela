# Discord Gateway Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discord Gateway connection using `discord.py` that listens to text messages, routes them through the LangGraph supervisor graph, and replies to the user/channel.

**Architecture:** Use a persistent async event loop task managed via FastAPI's lifespan handlers to connect the `discord.Client` instance, mapping Discord channel IDs to project conversation UUIDs in Supabase DB.

**Tech Stack:** `discord.py>=2.3.2`, `FastAPI`, `Supabase-py`, `pytest`

---

### Task 1: Setup dependencies & config

**Files:**
- Modify: `pyproject.toml`
- Modify: `.env.example`

- [ ] **Step 1: Add discord.py to dependencies**
  Edit `pyproject.toml` to include `"discord.py>=2.3.2"` under the main dependencies list.
  ```toml
  # pyproject.toml
  dependencies = [
      "fastapi>=0.110.0",
      "uvicorn[standard]>=0.28.0",
      "langgraph>=0.0.30",
      "langchain-core>=0.1.40",
      "langchain-google-genai>=1.0.2",
      "supabase>=2.4.0",
      "python-telegram-bot>=21.0.1",
      "discord.py>=2.3.2",
      "pydantic-settings>=2.2.1",
      "python-dotenv>=1.0.1",
      ...
  ```

- [ ] **Step 2: Add configuration to .env.example**
  Add the token variable to `.env.example`.
  ```env
  DISCORD_BOT_TOKEN=your_discord_bot_token
  ```

- [ ] **Step 3: Run uv sync to update environment**
  Run the command: `uv sync`
  Expected: Success exit code, `uv.lock` updated with discord.py and its dependencies.

- [ ] **Step 4: Commit task changes**
  Run:
  ```bash
  git add pyproject.toml .env.example uv.lock
  git commit -m "chore: add discord.py dependency and config"
  ```

---

### Task 2: Database Schema & Supabase Client updates

**Files:**
- Modify: `db/schema.sql`
- Modify: `db/supabase.py`
- Modify: `tests/test_db.py`

- [ ] **Step 1: Update schema.sql definition**
  Modify `db/schema.sql` to make `telegram_chat_id` nullable, and add `discord_channel_id`.
  ```sql
  CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      telegram_chat_id BIGINT UNIQUE,
      discord_channel_id BIGINT UNIQUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
  );
  ```

- [ ] **Step 2: Add failing database test in tests/test_db.py**
  Add the test method to `tests/test_db.py`:
  ```python
  @patch("db.supabase.create_client")
  def test_get_or_create_discord_conversation(mock_create_client):
      mock_supabase = MagicMock()
      mock_create_client.return_value = mock_supabase
      
      mock_execute = MagicMock()
      mock_execute.data = [{"id": "existing-discord-uuid"}]
      mock_supabase.table().select().eq().execute.return_value = mock_execute
      
      db = SupabaseDB()
      conv_id = db.get_or_create_discord_conversation(987654321)
      assert conv_id == "existing-discord-uuid"
      mock_supabase.table.assert_called_with("conversations")
  ```

- [ ] **Step 3: Run test to verify it fails**
  Run: `$env:PYTHONPATH="."; uv run pytest tests/test_db.py -k test_get_or_create_discord_conversation`
  Expected: Fail with `AttributeError: 'SupabaseDB' object has no attribute 'get_or_create_discord_conversation'`

- [ ] **Step 4: Implement get_or_create_discord_conversation in db/supabase.py**
  Add the following method to `SupabaseDB` class in `db/supabase.py`:
  ```python
      def get_or_create_discord_conversation(self, discord_channel_id: int) -> str:
          self.logger.info("Fetching Discord conversation", discord_channel_id=discord_channel_id)
          try:
              res = self.client.table("conversations").select("id").eq("discord_channel_id", discord_channel_id).execute()
              if res.data:
                  conv_id = res.data[0]["id"]
                  self.logger.info("Found existing Discord conversation", discord_channel_id=discord_channel_id, conversation_id=conv_id)
                  return conv_id
              
              insert_res = self.client.table("conversations").insert({"discord_channel_id": discord_channel_id}).execute()
              conv_id = insert_res.data[0]["id"]
              self.logger.info("Created new Discord conversation record", discord_channel_id=discord_channel_id, conversation_id=conv_id)
              return conv_id
          except Exception as e:
              self.logger.error("Database query failed, returning fallback mock-uuid", error=str(e), discord_channel_id=discord_channel_id)
              return "mock-conversation-uuid"
  ```

- [ ] **Step 5: Verify the test passes**
  Run: `$env:PYTHONPATH="."; uv run pytest tests/test_db.py`
  Expected: 2 passed.

- [ ] **Step 6: Commit changes**
  Run:
  ```bash
  git add db/schema.sql db/supabase.py tests/test_db.py
  git commit -m "feat: support discord channel conversations in database client"
  ```

---

### Task 3: Discord Gateway Implementation

**Files:**
- Create: `gateway/discord.py`
- Create: `tests/test_discord.py`

- [ ] **Step 1: Write the failing test**
  Create `tests/test_discord.py` to assert that message handling triggers LangGraph invocation and replies correctly:
  ```python
  import pytest
  from unittest.mock import MagicMock, AsyncMock, patch
  from langchain_core.messages import AIMessage
  from gateway.discord import DiscordGateway
  
  @pytest.mark.asyncio
  @patch("gateway.discord.graph.invoke")
  async def test_on_message_handles_incoming_text(mock_graph_invoke):
      mock_db = MagicMock()
      mock_db.get_or_create_discord_conversation.return_value = "discord-conv-uuid"
      
      mock_graph_invoke.return_value = {"messages": [AIMessage(content="Hello from AI!")]}
      
      gateway = DiscordGateway(db=mock_db)
      
      # Mock discord.Message
      mock_message = MagicMock()
      mock_message.author = MagicMock()
      mock_message.author.bot = False
      mock_message.content = "Hello bot"
      mock_message.channel = MagicMock()
      mock_message.channel.id = 12345
      
      # Mock the typing async context manager
      mock_typing = AsyncMock()
      mock_message.channel.typing.return_value = mock_typing
      
      # Mock channel send as AsyncMock
      mock_message.channel.send = AsyncMock()
      
      # Get the registered message handler
      on_message_handler = None
      for event, listeners in gateway.client._listeners.items():
          if event == "message":
              on_message_handler = listeners[0]
              
      assert on_message_handler is not None
      await on_message_handler(mock_message)
      
      mock_db.get_or_create_discord_conversation.assert_called_with(12345)
      mock_graph_invoke.assert_called_once()
      mock_message.channel.send.assert_called_with("Hello from AI!")
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:PYTHONPATH="."; uv run pytest tests/test_discord.py`
  Expected: Fail with `ModuleNotFoundError: No module named 'gateway.discord'`

- [ ] **Step 3: Implement gateway/discord.py**
  Create `gateway/discord.py`:
  ```python
  import discord
  import os
  import asyncio
  from langchain_core.messages import HumanMessage
  from agent.graph import graph
  from utils.logger import StructuredLogger
  from db.supabase import SupabaseDB
  
  class DiscordGateway:
      def __init__(self, db: SupabaseDB):
          self.logger = StructuredLogger("DiscordGateway")
          self.db = db
          intents = discord.Intents.default()
          intents.message_content = True
          intents.messages = True
          self.client = discord.Client(intents=intents)
          self._register_handlers()
  
      def _register_handlers(self):
          @self.client.event
          async def on_ready():
              self.logger.info("Discord Bot connected", bot_user=str(self.client.user))
  
          @self.client.event
          async def on_message(message: discord.Message):
              # Check if bot message or message from self
              if message.author == self.client.user or (hasattr(message.author, "bot") and message.author.bot):
                  return
  
              self.logger.info("Received Discord message", channel_id=message.channel.id, author=str(message.author))
              
              try:
                  conv_id = self.db.get_or_create_discord_conversation(message.channel.id)
                  
                  inputs = {
                      "messages": [HumanMessage(content=message.content)],
                      "telegram_chat_id": 0,
                      "db_conv_id": conv_id,
                      "relevant_memories": [],
                      "next_node": ""
                  }
                  
                  async with message.channel.typing():
                      res = await asyncio.to_thread(graph.invoke, inputs)
                  
                  assistant_reply = "I couldn't process that request."
                  if res.get("messages"):
                      assistant_reply = res["messages"][-1].content
                  
                  await message.channel.send(assistant_reply)
                  self.logger.info("Sent reply to Discord", channel_id=message.channel.id)
              except Exception as e:
                  self.logger.error("Error handling Discord message", error=str(e))
  
      async def start(self):
          token = os.getenv("DISCORD_BOT_TOKEN")
          if not token or token == "your_discord_bot_token" or token == "mock_token":
              self.logger.warning("DISCORD_BOT_TOKEN is not set or is mock. Discord gateway will not start.")
              return
          self.logger.info("Starting Discord bot client...")
          await self.client.start(token)
  
      async def close(self):
          self.logger.info("Closing Discord bot client...")
          await self.client.close()
  ```

- [ ] **Step 4: Verify the tests pass**
  Run: `$env:PYTHONPATH="."; uv run pytest tests/test_discord.py`
  Expected: 1 passed.

- [ ] **Step 5: Commit changes**
  Run:
  ```bash
  git add gateway/discord.py tests/test_discord.py
  git commit -m "feat: implement DiscordGateway and unit tests"
  ```

---

### Task 4: Integrate Gateway into FastAPI App Lifespan

**Files:**
- Modify: `agent/main.py`
- Modify: `tests/test_api.py`

- [ ] **Step 1: Write failing test / behavior check in tests/test_api.py**
  Modify `tests/test_api.py` to assert that the lifespan events trigger startup/shutdown tasks of discord gateway (via mock):
  ```python
  from fastapi.testclient import TestClient
  from unittest.mock import patch, AsyncMock
  
  @patch("agent.main.discord_gateway.start", new_callable=AsyncMock)
  @patch("agent.main.discord_gateway.close", new_callable=AsyncMock)
  def test_lifespan_starts_and_stops_discord_gateway(mock_close, mock_start):
      from agent.main import app
      with TestClient(app) as client:
          # Verify health check is accessible
          response = client.get("/health")
          assert response.status_code == 200
      
      mock_start.assert_called_once()
      mock_close.assert_called_once()
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:PYTHONPATH="."; uv run pytest tests/test_api.py -k test_lifespan`
  Expected: Fail with `AttributeError: module 'agent.main' has no attribute 'discord_gateway'`

- [ ] **Step 3: Implement lifespan task in agent/main.py**
  Modify `agent/main.py` to instantiate and start/stop the `discord_gateway`. Use FastAPI's async lifespan context manager.
  
  ```python
  # agent/main.py
  import os
  import asyncio
  from contextlib import asynccontextmanager
  from fastapi import FastAPI, Depends, Query, responses, Request
  from google_auth_oauthlib.flow import Flow
  from db.supabase import SupabaseDB
  from gateway.telegram import TelegramGateway
  from gateway.discord import DiscordGateway
  from cron.consolidate import run_self_improvement
  from utils.logger import StructuredLogger
  
  logger = StructuredLogger("VelaServer")
  db = SupabaseDB()
  telegram_gateway = TelegramGateway()
  discord_gateway = DiscordGateway(db=db)
  
  @asynccontextmanager
  async def lifespan(app: FastAPI):
      logger.info("Initializing background services...")
      # Start discord gateway in a background task
      discord_task = asyncio.create_task(discord_gateway.start())
      yield
      # Clean up on shutdown
      logger.info("Shutting down background services...")
      await discord_gateway.close()
      discord_task.cancel()
      try:
          await discord_task
      except asyncio.CancelledError:
          pass
  
  app = FastAPI(title="Vela Server", lifespan=lifespan)
  ```

- [ ] **Step 4: Verify the tests pass**
  Run: `$env:PYTHONPATH="."; uv run pytest`
  Expected: All tests pass.

- [ ] **Step 5: Commit changes**
  Run:
  ```bash
  git add agent/main.py tests/test_api.py
  git commit -m "feat: integrate DiscordGateway into FastAPI lifespan"
  ```

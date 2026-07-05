# Vela: Personal Supervisor Agent Backend

Vela is an advanced, FastAPI-powered personal assistant backend designed to coordinate simple utility tools and complex, multi-turn cognitive skills. Utilizing a **Supervisor Agent Pattern** built on **LangGraph**, Vela dynamically routes intents to sub-agent workflows or tools while maintaining server-side long-term semantic memory and performing dynamic self-improvement evaluations.

Vela supports multiple gateways to interface with users:
1. **Telegram Bot** (webhook-driven updates with async execution).
2. **Discord Bot** (event-driven client monitoring using `discord.py` and prefixed commands).
3. **Vela Mobile Client** (REST API with SSE streaming support for custom frontend clients).

---

## 🚀 Key Features

*   **Supervisor Graph (LangGraph):** Orchestrates intent classification and executes routing dynamically between tools and sub-agent workflows.
*   **Long-Term Semantic Memory (Supabase pgvector):** Leverages text embeddings to store and query contextually relevant memory history server-side with 512-dimensional vector indexing.
*   **Google Workspace OAuth Integration:** Automates token exchanges and credentials management for Gmail and Google Calendar.
*   **Tavily Web Search:** Deep real-time web search integration.
*   **E2B Sandboxed Playground:** Secure code execution environment.
*   **Nightly Self-Improvement Loop:** Processes recent transaction experiences, evaluates response performance, and refines system prompts dynamically.
*   **Multi-Turn Agentic Skills:** Native support for Brainstorming, Research, and Sandbox Coding skills.

---

## 🛠️ Tech Stack

*   **Runtime:** Python 3.11+
*   **Package Manager:** [uv](https://github.com/astral-sh/uv) (fast Python packaging tool)
*   **API Framework:** FastAPI & Uvicorn
*   **Workflow Engine:** LangGraph & LangChain Core
*   **Database:** PostgreSQL (Supabase) utilizing the `vector` extension and SQLAlchemy ORM
*   **Chat Platforms:** `python-telegram-bot` & `discord.py`
*   **Testing:** `pytest` & `pytest-asyncio`

---

## 📦 Project Structure

```text
Vela/
├── db/
│   ├── client.py             # Database CRUD client wrapper
│   ├── models.py             # SQLAlchemy models (Conversations, Experiences, OAuthTokens, etc.)
│   ├── schema.sql            # Database schema migration script (tables & extensions)
│   ├── session.py            # SQLAlchemy database engine and thread-safe sessions
│   └── supabase.py           # Supabase DB wrapper with pgvector search
├── agent/
│   ├── main.py               # FastAPI server (Webhook, OAuth callbacks, Client endpoints)
│   ├── graph.py              # LangGraph Supervisor workflow definition
│   ├── router.py             # Supervisor Routing Node
│   ├── memory.py             # Semantic Memory utility helpers
│   ├── self_improve.py       # LLM-based evaluation logic
│   └── prompt_builder.py     # Prompt assembly from fragments
├── tools/
│   ├── web_search.py         # Tavily search client
│   ├── code_exec.py          # E2B execution wrapper
│   ├── gmail.py              # OAuth Gmail helper
│   ├── calendar.py           # OAuth Calendar helper
│   ├── github.py             # GitHub API actions
│   └── notion.py             # Notion integration
├── skills/
│   ├── base.py               # Abstract base class for multi-turn skills
│   ├── brainstorming.py      # Clarifying interview simulator
│   ├── research.py           # Deep research agent
│   └── coding.py             # Sandbox developer/reviewer
├── gateway/
│   ├── telegram.py           # Telegram Update parser & webhook receiver
│   └── discord.py            # Discord event handler bot
├── cron/
│   ├── health.py             # Keep-alive check
│   └── consolidate.py        # System prompt consolidation script (nightly loop)
└── tests/                    # Comprehensive unit tests suite
```

---

## ⚙️ Prerequisites & General Setup

Ensure you have the following installed on your machine:
*   Python 3.11+
*   `uv` Package Manager

### 1. Install Dependencies
Initialize the virtual environment and sync packages:
```bash
uv sync
```

### 2. Environment Configuration
Copy [.env.example](file:///d:/work/projects/Vela/.env.example) to `.env` and fill in the required keys:
```bash
cp .env.example .env
```

**Key configuration parameters include:**
*   `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`: Service credentials for your Supabase project.
*   `DATABASE_URL`: Connection string to your PostgreSQL instance (e.g. Supabase DB).
*   `GOOGLE_API_KEY`: API Key for Gemini LLM (used as the primary agent reasoning model).
*   `VELA_API_KEY`: Custom static Bearer token used to authenticate mobile/external clients (defaults to `vela5012`).
*   `TAVILY_API_KEY` & `E2B_API_KEY`: API keys for web search and sandbox code execution respectively.

---

## 🗄️ Step 1: Database Setup (Supabase pgvector)

Vela uses a PostgreSQL database with `pgvector` enabled to store conversations, experiences, tokens, and semantic memories (using 512-dimensional embeddings).

1. Go to your **Supabase Dashboard** > **SQL Editor**.
2. Create a new query.
3. Open [db/schema.sql](file:///d:/work/projects/Vela/db/schema.sql) and paste its contents.
4. Execute the SQL script. This will:
    *   Enable the `vector` extension.
    *   Create `conversations`, `oauth_tokens`, `memory_vectors` (dimension 512), `experiences`, `system_prompt_fragments`, and `skills_registry` tables.
    *   Set up foreign keys and cascading deletions.

---

## 🤖 Step 2: Telegram Bot Integration Setup

The Telegram integration uses webhooks to deliver update payloads to the FastAPI backend.

1. **Create the Bot:**
    *   Open Telegram and search for `@BotFather`.
    *   Send `/newbot` and follow the instructions to get your **Bot Token**.
    *   Save this token in your `.env` file: `TELEGRAM_BOT_TOKEN=your_bot_token`.

2. **Expose your Local Server:**
    *   Because Telegram webhooks require an HTTPS URL, expose your local backend server during development using a tunneling tool (like `ngrok` or `localtunnel`):
        ```bash
        ngrok http 8000
        ```
    *   Copy the HTTPS URL generated (e.g., `https://xxxx.ngrok-free.app`).

3. **Register Webhook with Telegram:**
    *   Run a HTTP GET request in your browser or curl to register your webhook:
        ```text
        https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=<YOUR_TUNNEL_HTTPS_URL>/webhooks/telegram
        ```
    *   Ensure the response confirms: `{"ok":true,"result":true,"description":"Webhook was set"}`.

4. **Verify Communication:**
    *   Send a message to your Telegram bot.
    *   The payload will hit the `POST /webhooks/telegram` endpoint in [agent/main.py](file:///d:/work/projects/Vela/agent/main.py#L448-L453), executing the routing logic asynchronously in the background.

---

## 💬 Step 3: Discord Bot Integration Setup

The Discord bot integration acts as an event-driven bot gateway running on the server's lifecycle.

1. **Create a Discord Application:**
    *   Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    *   Click **New Application** and give it a name.
    *   Navigate to the **Bot** tab on the left sidebar and click **Add Bot**.

2. **Configure Bot Permissions & Intents:**
    *   Scroll down on the **Bot** page to **Privileged Gateway Intents**.
    *   **Crucial:** Enable **Message Content Intent** (and **Presence/Server Members Intents** if desired). This is required so the bot can read incoming channel messages.
    *   Save changes.

3. **Obtain Bot Token:**
    *   Under the **Bot** tab, click **Reset Token** to generate a new Bot Token.
    *   Add this token to your `.env` file: `DISCORD_BOT_TOKEN=your_discord_bot_token`.

4. **Invite Bot to Server:**
    *   Go to the **OAuth2** > **URL Generator** tab.
    *   Select the `bot` scope.
    *   Under **Bot Permissions**, select:
        *   `Send Messages`
        *   `Read Message History`
        *   `Use Slash Commands`
    *   Copy the generated URL at the bottom and open it in a browser to invite the bot to your Discord server.

5. **Server Lifecycle Setup:**
    *   To run the Discord bot alongside the FastAPI server, it must be started as a background task.
    *   Uncomment or insert the Discord task startup inside the `lifespan` handler in [agent/main.py](file:///d:/work/projects/Vela/agent/main.py#L32-L47):
        ```python
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            # ... database migrations ...
            # Start Discord Gateway task in the background
            discord_task = asyncio.create_task(discord_gateway.start())
            yield
            # Shutdown and cleanup
            await discord_gateway.close()
            discord_task.cancel()
            try:
                await discord_task
            except asyncio.CancelledError:
                pass
        ```
    *   When the server is run, the Discord bot will connect automatically. It listens for messages beginning with the `v.` prefix (e.g., `v. research artificial general intelligence`) in channels it has access to.

---

## 📱 Step 4: Connecting with Vela Android Client

Vela has a dedicated mobile application client: [Vela Android Client](https://github.com/parth5012/vela-android-client).

### 1. Download the Mobile App
Download the latest `.apk` release directly from the [Vela Android Client Releases page](https://github.com/parth5012/vela-android-client/releases). Install it on your Android device.

### 2. Host the Vela Backend
To connect the mobile app, the Vela backend server must be publicly accessible (or on the same local network):
*   **Public Hosting:** You can host this project on platforms like Render, Railway, or self-host it on a VPS/Server with a public domain or IP.
*   **Local Network:** If running locally, ensure your mobile device and backend server are on the same Wi-Fi network.

### 3. Connection Configuration
When you launch the Vela mobile app for the first time, you will be prompted to enter the configuration settings:
*   **Server URL:** Enter the public URL (e.g., `https://your-vela-backend.com`) or the local IP address (e.g., `http://192.168.1.100:8000`) of your hosted Vela backend.
*   **API Key:** Enter your configured `VELA_API_KEY` (configured in your backend `.env` file, which defaults to `vela5012`).

Once saved, the client will verify the server connection and API Key validity by calling `GET /health` with Bearer Token authentication. On successful validation, you can immediately start creating threads and talking to your Vela assistant.

### 4. Backend-Client API Specification
For custom developers, the mobile client communicates with the backend via the following REST and SSE endpoints:

*   **Authentication:** All requests require the header:
    ```text
    Authorization: Bearer <VELA_API_KEY>
    ```
*   **List Threads:** `GET /chat/threads` lists user conversation threads.
*   **Fetch Messages:** `GET /chat/threads/{thread_id}` fetches historical messages.
*   **Send Message & SSE Stream:** `POST /chat/message`
    Request Payload:
    ```json
    {
      "thread_id": "thread-uuid",
      "message": "Calculate the derivative of x^2",
      "persona": "personal assistant"
    }
    ```
    Response Streams data in SSE chunks:
    *   `data: {"type": "content", "delta": "The derivative is "}`
    *   `data: {"type": "done", "thread_title": "Derivative of x^2"}`

---

## 🏃 Running the Application

### 1. Launch FastAPI Server
Run the backend web app locally using `uv`:
```bash
uv run uvicorn agent.main:app --reload
```
By default, the server runs on `http://127.0.0.1:8000`. You can visit `http://127.0.0.1:8000/` or `http://127.0.0.1:8000/docs` to see API docs.

---

## 🧪 Running Tests

A comprehensive test suite is provided to ensure backend validation and gateways perform correctly.

Run the test suite with:
```bash
uv run python -m pytest -v
```

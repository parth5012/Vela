# 🌌 Vela: The Sovereign AI Operating System

<div align="center">

[![License](https://img.shields.io/badge/license-Apache%202.0%20%7C%20MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB.svg?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111+-009688.svg?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![LangGraph](https://img.shields.io/badge/LangGraph-Supervisor%20Architecture-FF4F00.svg?style=for-the-badge&logo=langchain&logoColor=white)](https://github.com/langchain-ai/langgraph)
[![React Native / Expo](https://img.shields.io/badge/Expo-SDK%2057%20(RN%200.86)-000020.svg?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![Supabase pgvector](https://img.shields.io/badge/Supabase-pgvector%20512--dim-3ECF8E.svg?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Shizuku Privileged Automation](https://img.shields.io/badge/Shizuku-Privileged%20Android%20OS-brightgreen.svg?style=for-the-badge&logo=android&logoColor=white)](https://shizuku.rikka.app)
[![CI Gate](https://img.shields.io/badge/CI%20Gate-Passing-success.svg?style=for-the-badge&logo=githubactions&logoColor=white)](vela_ci.py)

**Your single-tenant, self-hosted, personal AI supervisor—uniting cloud reasoning, on-device neural models, privileged Android OS automation, persistent semantic memory, and a glassmorphic Aurora client.**

[Features](#-key-capabilities) • [Architecture](#-system-architecture) • [Quickstart](#-quickstart-guide) • [Android Client](#-flagship-android-client) • [Device Automation](#-privileged-os-automation-shizuku) • [On-Device AI](#-hybrid-cloud--on-device-local-ai) • [Quality & CI](#-ui-council--performance-ratchets) • [API Specs](#-api--streaming-protocol)

---

</div>

## 💡 Why Vela?

Commercial AI assistants trap your private data inside proprietary walled gardens, run exclusively in the cloud, refuse to take real actions on your hardware, and forget your conversations the moment a thread ends. 

**Vela is built on a radically different premise: *The Owner's data stays on the Owner's infrastructure.***

*   🛡️ **100% Sovereign & Self-Hosted:** Single-tenant by design. You run the backend on your own server or VPS. No telemetry, no third-party data harvesting, and no subscription lock-in.
*   🦾 **True OS-Level Automation:** Directly controls your Android device via **Shizuku** (ADB/root UID permissions without rooting). Manages apps, toggles system settings, and automates real workflows.
*   🧠 **Supervisor Cognitive Architecture:** Built on **LangGraph**. A master supervisor classifies intents, delegating dynamically between specialized multi-turn cognitive subagents and atomic tools.
*   ⚡ **Hybrid Edge + Cloud Intelligence:** Seamlessly switch between cutting-edge frontier LLMs (Gemini 2.5, Claude 3.5, GPT-4o, Groq) and **100% offline on-device neural models** (Needle-3 Cactus C++ engine, MediaPipe LiteRT, llama.rn GGUF).
*   🔄 **Nightly Autonomous Self-Improvement:** Evaluates daily interaction experiences, identifies conversational friction, and autonomously refines its own prompt fragments using `pgvector` memory reflection.
*   🎨 **Aurora Glass UI:** A gorgeous, night-sky glassmorphic Android client with real-time SSE streaming, KaTeX math equations, interactive Mermaid diagrams, and 6 dark theme atmospheres.

---

## ⚡ Feature Matrix at a Glance

| Capability | Vela | Closed Commercial Bots (ChatGPT / Claude) | Generic Open-Source Web UIs |
| :--- | :---: | :---: | :---: |
| **Self-Hosted Data Sovereignty** | **Yes (Single-tenant Owner)** | ❌ No (Vendor Cloud) | ⚠️ Partial (UI only, no supervisor) |
| **Android System Privileged Ops (Shizuku)** | **Yes (UID 2000 ADB / UID 0 Root)** | ❌ No | ❌ No |
| **Hybrid Cloud + Offline On-Device LLM** | **Yes (Needle-3 / LiteRT / GGUF)** | ❌ Cloud-only | ⚠️ Requires separate Ollama setup |
| **LangGraph Supervisor Graph Routing** | **Yes (Dynamic Intent Router)** | ❌ Black-box monolithic | ❌ Simple system prompt wrapper |
| **Long-Term Memory Reflection** | **Yes (Supabase pgvector + Cron)** | ⚠️ Vendor-controlled | ❌ Session-bound or raw DB |
| **Nightly Autonomous Self-Improvement** | **Yes (Auto-refines prompts)** | ❌ Static | ❌ None |
| **Agentic In-App Browser Automation** | **Yes (with Human-in-the-Loop Gate)** | ⚠️ Cloud browser only | ❌ None |
| **Multi-Channel Gateways** | **Android, Telegram, Discord, Voice** | ❌ App/Web only | ⚠️ Discord or Web only |
| **Visual UI Quality Council** | **Yes (Sol/Opus/Muse automated audits)** | ❌ Internal QA | ❌ None |

---

## 🚀 Key Capabilities

### 1. 🧠 Supervisor Agent Pattern & Cognitive Skills
Built on **LangGraph**, Vela coordinates a hierarchical agent topology with zero tool hallucination:
*   **Dynamic Intent Classification:** Inspects incoming context and routes to either dedicated multi-turn cognitive skills or targeted tools.
*   **7 Specialized Agent Personas:**
    *   **Personal Assistant:** Calendar, daily agendas, email triage, and smart task management.
    *   **Deep Researcher:** Exhaustive multi-source web investigation with Tavily search and citation extraction.
    *   **Software Architect / Coder:** Sandboxed code development, test generation, and review via isolated E2B containers.
    *   **Brainstorming Partner:** Socratic interview loops that clarify vague ideas into concrete specs.
    *   **Analytical Engine:** Deep quantitative breakdowns and structured data dissection.
    *   **Prompt Builder:** Meta-prompt refinement and agent-directed instruction generation.
    *   **Teacher & Mentor:** Step-by-step conceptual breakdowns with pedagogical clarity.
*   **Agent Tool Registry:** Enforces strict, explicit tool bindings per persona, drastically reducing token consumption and preventing unauthorized tool execution.

### 2. 📱 Flagship Android Client ("Aurora" Glass Language)
A modern client built with **Expo SDK 57 / React Native 0.86** designed under Material Design 3 guidelines:
*   **Aurora Glassmorphism:** Translucent glass cards, ambient glow gradients, ultra-thin borders, and night-sky depth.
*   **6 Dark Atmospheres & 8 Energy Accents:**
    *   *Atmospheres:* Deep Space, Slate, Cyberpunk, OLED Pure Black, Dracula, Nordic Dusk.
    *   *Energy Accents:* Aurora gradient highlights for message bubbles, send triggers, and glowing active states.
*   **Rich Interactive Rendering:**
    *   **KaTeX LaTeX:** Flawless rendering for complex mathematical expressions and scientific notation (inline & block).
    *   **Mermaid Diagrams:** Flowcharts, sequence diagrams, and architecture graphs rendered natively in-chat.
    *   **Fenced Code Blocks:** Syntax highlighting across 40+ programming languages with one-tap copy and line numbers.
    *   **Transparent Cognitive Disclosures:** Collapsible `<thought>`, `<intent>`, `<call>`, and `<skill>` blocks show the agent's exact thinking process.
*   **Conversation Lifecycle:** Branching, pinning, renaming, truncation, and fast local SQLite caching (Drizzle ORM).

### 3. 🦾 Privileged OS Automation (Shizuku + Accessibility)
Vela bridges the gap between conversational AI and native Android system capabilities:
*   **No Root Required:** Leverages **Shizuku** to execute privileged APIs via ADB (UID 2000) or Root (UID 0) user-services.
*   **8 Strictly Allowlisted System Operations:**
    1.  `pm_grant`: Grant runtime permissions to any package.
    2.  `pm_revoke`: Revoke runtime permissions safely.
    3.  `settings_put`: Modify `system`, `secure`, and `global` Android settings on the fly.
    4.  `force_stop`: Terminate background processes and misbehaving apps.
    5.  `set_enabled`: Freeze or enable system packages and bloatware.
    6.  `clear_data`: Clear app storage and resets application cache.
    7.  `install`: Background silent APK sideloading with absolute paths.
    8.  `uninstall`: Cleanly remove installed applications.
*   **Dual-Gate Security Architecture:**
    *   *Readiness Gate:* Verifies Shizuku server availability and permission state before any action.
    *   *Policy Tier Gate:* Strict Owner control over tool permissions (`Auto`, `Ask`, `Deny`).
*   **Accessibility Service Companion:** Performs non-privileged UI automation (clicking, scrolling, typing, screen inspection).

### 4. 🔒 Hybrid Cloud + On-Device Local AI
Run frontier models when you have connectivity; fall back to private, local models when offline or handling sensitive data:
*   **Multi-Engine On-Device Runtime:**
    *   **Needle-3 Cactus Engine:** Statically linked, Apache-2.0 licensed, 20-layer neural network with 8,192 context window, accelerated via native C++ JNI.
    *   **MediaPipe LiteRT:** Mobile GPU-accelerated `.task` inference using Google's tasks-genai runtime.
    *   **llama.rn:** High-performance quantized GGUF inference directly on your phone's SoC.
*   **Capability Honesty:** The Settings engine badge displays real status (`⚡ Accelerated (native)` vs `Mock Fallback`) so mock outputs are never misrepresented.
*   **Local Constrained JSON Extraction (`/settings/extract`):** Enforces JSON schema adherence directly on local weights without network latency.

### 5. 🌐 Agentic In-App Browser with Human-in-the-Loop
*   **AI-Driven WebView:** The assistant can autonomously navigate pages, read the DOM, extract research data, and interact with web forms.
*   **Human Approval Gate:** Sensitive browser actions—such as filling passwords, submitting payment credentials, or form execution—trigger a prominent Owner confirmation modal before execution.

### 6. 🔄 Persistent Semantic Memory & Self-Improvement
*   **Vectorized Memory (Supabase pgvector):** Conversations and facts are converted to 512-dimensional vector embeddings, allowing the agent to recall preferences and decisions across months of conversations.
*   **Autonomous Nightly Reflection (`cron/consolidate.py`):**
    *   Processes recent conversation `Experiences` and execution outcomes.
    *   Identifies routing mistakes, user corrections, and successful patterns.
    *   Synthesizes and dynamically updates system prompt fragments in PostgreSQL, making the assistant smarter every single night.

### 7. 💬 Omni-Channel Gateways
Access your assistant wherever you are:
*   **Vela Android App:** Real-time SSE streaming, voice inputs, and device automation.
*   **Telegram Bot:** Webhook-driven background execution with asynchronous processing.
*   **Discord Bot:** Event-driven gateway with prefix (`v.`) and slash command support.
*   **CarbonVoice Gateway:** Spoken audio interactions and ambient voice notes.

### 8. 🛠️ External Tool Integrations
*   **Google Workspace (OAuth2):** Full Gmail and Google Calendar integration with **Auto-Refresh Propagation** (server-side token refresh and automatic DB persistence).
*   **Tavily Web Search:** Real-time web search with source extraction and domain filtering.
*   **E2B Sandbox:** Secure, sandboxed cloud micro-VMs for executing arbitrary Python, Node.js, and Bash code.

### 9. 🛡️ Visual Quality Council & Performance Ratchet Harness
*   **UI Council Screenshot Scoring Harness (`scripts/ui-council.ts`):** Automated visual regression scoring with a tiered multi-agent council (Sol/GPT -> Opus/Claude -> Muse -> Jester/Gemini) with non-determinism tracking.
*   **Performance Ratchet & Telemetry:** In-app metrics ring buffer tracking request latency, SQLite storage query timings, and JS-thread frame drops (`requestAnimationFrame` cadence) viewable via `docs/metrics-dashboard.html`.
*   **Single-Command CI Gate:** A unified command (`python vela_ci.py ci`) that gates releases across Backend, Client, Corpus, and Playwright UI e2e tests.

---

## 🏛️ System Architecture

```text
                                 ┌──────────────────────────────────────────────┐
                                 │                 USER CHANNELS                │
                                 │  Android App  •  Telegram  •  Discord • Voice│
                                 └──────────────────────┬───────────────────────┘
                                                        │
                                                        ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       VELA FASTAPI BACKEND SERVER                                    │
│                                                                                                      │
│  ┌────────────────────────┐         ┌────────────────────────┐         ┌──────────────────────────┐  │
│  │    Authentication Gate │         │ SSE Streaming Protocol │         │   OAuth Token Manager    │  │
│  │    (Bearer VELA_KEY)   │         │ (Chunk + XML Parsers)  │         │ (Auto-Refresh & Storage) │  │
│  └───────────┬────────────┘         └───────────┬────────────┘         └─────────────┬────────────┘  │
│              │                                  │                                    │               │
│              ▼                                  ▼                                    ▼               │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                               LANGGRAPH SUPERVISOR AGENT WORKFLOW                              │  │
│  │                                                                                                │  │
│  │     ┌─────────────────────┐             ┌─────────────────────┐            ┌────────────────┐  │  │
│  │     │   Semantic Memory   │ ──context──►│  Intent Classifier  │──routes───►│ Persona Prompt │  │  │
│  │     │ (pgvector 512-dim)  │             │   (Supervisor)      │            │   Assembly     │  │  │
│  │     └─────────────────────┘             └──────────┬──────────┘            └───────┬────────┘  │  │
│  │                                                    │                               │           │  │
│  │                    ┌───────────────────────────────┴──────────────────┐            │           │  │
│  │                    ▼                                                  ▼            ▼           │  │
│  │         ┌─────────────────────┐                            ┌─────────────────────┐             │  │
│  │         │  Multi-Turn Skills  │                            │ Agent Tool Registry │             │  │
│  │         │ • Deep Research     │                            │ • Google Workspace  │             │  │
│  │         │ • E2B Sandbox Code  │                            │ • Tavily Web Search │             │  │
│  │         │ • Brainstorming     │                            │ • Shizuku Bridge    │             │  │
│  │         │ • Mermaid Graphs    │                            │ • WebView Browser   │             │  │
│  │         └─────────────────────┘                            └─────────────────────┘             │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                NIGHTLY SELF-IMPROVEMENT LOOP                                   │  │
│  │          Experiences Log ──► Reflection LLM ──► Refined Prompt Fragments ──► PostgreSQL        │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                        │
                         ┌──────────────────────────────┴──────────────────────────────┐
                         ▼                                                             ▼
┌─────────────────────────────────────────────────┐   ┌─────────────────────────────────────────────────┐
│              SOVEREIGN DATA LAYER               │   │             ANDROID DEVICE RUNTIME              │
│  • Supabase PostgreSQL (pgvector 512)           │   │  • Shizuku System Daemon (Shell UID 2000)       │
│  • SQLAlchemy Session Management                │   │  • Accessibility Service UI Automation          │
│  • Local Client Cache (SQLite + Drizzle ORM)    │   │  • On-Device Neural Models (Needle-3 / LiteRT)  │
└─────────────────────────────────────────────────┘   └─────────────────────────────────────────────────┘
```

---

## ⚡ Quickstart Guide

### Prerequisites
*   **Python:** 3.11+
*   **Package Manager:** [uv](https://github.com/astral-sh/uv) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
*   **Node.js & npm:** Node 20+ (for Expo Android client)
*   **Database:** PostgreSQL with `vector` extension (e.g. free [Supabase](https://supabase.com) project)

---

### Step 1: Clone & Configure Backend

```bash
# Clone the repository
git clone https://github.com/parth5012/Vela.git
cd Vela/backend

# Install dependencies using uv
uv sync

# Configure environment variables
cp .env.example .env
```

Edit `.env` with your credentials:
```ini
# Supabase Database & Vectors
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
DATABASE_URL="postgresql://postgres:password@db.your-project.supabase.co:5432/postgres"

# Primary Reasoning Model
GOOGLE_API_KEY="your-gemini-api-key"

# Client Security (Static Bearer Token)
VELA_API_KEY="your-secure-custom-key"

# Optional External Tools
TAVILY_API_KEY="your-tavily-key"
E2B_API_KEY="your-e2b-sandbox-key"
TELEGRAM_BOT_TOKEN="your-telegram-token"
DISCORD_BOT_TOKEN="your-discord-token"
```

---

### Step 2: Initialize Database Schema

1. Open your **Supabase Dashboard** > **SQL Editor**.
2. Run the SQL script from `backend/db/schema.sql` to initialize tables and enable `pgvector` (dimension 512).
3. Validate your setup:
   ```bash
   uv run python scripts/setup_check.py
   ```

---

### Step 3: Run the Backend Server

```bash
uv run uvicorn agent.main:app --host 0.0.0.0 --port 8000 --reload
```
*   API Docs: `http://localhost:8000/docs`
*   Health Endpoint: `http://localhost:8000/health` (Protected with `Authorization: Bearer <VELA_API_KEY>`)

---

### Step 4: Launch the Android Client

```bash
cd ../client

# Install dependencies
npm install

# Start the Expo development server
npm start
```

*   **Run on Physical Phone:** Scan the QR code using Expo Go or run `npm run android` with your device connected via USB debugging.
*   **First-Time Setup:** On the setup screen, enter your Backend Server URL (`http://<your-lan-ip>:8000` or `https://your-domain.com`) and your `VELA_API_KEY`. The app validates connectivity via `GET /health` and navigates straight into chat.

---

## 🦾 Privileged Android Setup (Shizuku)

To enable the Device Agent to execute privileged actions without rooting:

1. Install **Shizuku** from Google Play or [shizuku.rikka.app](https://shizuku.rikka.app).
2. Enable **Developer Options** and turn on **Wireless Debugging** on your phone.
3. Open Shizuku, tap **Pairing**, and enter the pairing code from Wireless Debugging.
4. Tap **Start** in Shizuku.
5. In the Vela Android App, open **Settings → Permissions → Shizuku Setup**; tap **Request Permission**.
6. The status badge will read **⚡ Ready (UID 2000 ADB)**. You can now configure policy tiers (`Auto`, `Ask`, `Deny`) for permission grants, app management, and settings control!

---

## 🧪 Verification & Release Quality

Vela uses a rigorous single-command gate for all testing and continuous integration:

```bash
# Run the complete CI gate (Backend, Client, Corpus, Playwright e2e)
python vela_ci.py ci

# Run specific stacks
python vela_ci.py ci --stack backend
python vela_ci.py ci --stack client
python vela_ci.py ci --stack corpus

# Run UI Screenshot Council Scoring
npx tsx scripts/ui-council.ts --dry-run path/to/screenshot.png

# Compare Performance Metrics Snapshot against baseline
node scripts/metrics-compare.ts --baseline perf-baseline.json --current current-metrics.json
```

---

## 📡 API & Streaming Protocol

The client-server communication uses a high-performance SSE stream:

*   **Endpoint:** `POST /chat/message`
*   **Headers:** `Authorization: Bearer <VELA_API_KEY>`, `Content-Type: application/json`
*   **Request Payload:**
    ```json
    {
      "thread_id": "01J9...",
      "message": "Research the implications of quantum annealing on RSA encryption",
      "persona": "researcher"
    }
    ```
*   **Response SSE Chunks:**
    ```text
    data: {"type": "content", "delta": "<thought>Analyzing quantum annealing vs Shor's algorithm...</thought>"}
    data: {"type": "content", "delta": "\n\n### Executive Summary\nQuantum annealing..."}
    data: {"type": "done", "thread_title": "Quantum Annealing & RSA Security"}
    ```

---

## 🗺️ Project Structure

```text
Vela/
├── backend/                  # FastAPI + LangGraph Python Backend
│   ├── agent/                # Supervisor graph, router, persona prompts, concurrency
│   ├── db/                   # SQLAlchemy ORM, Supabase pgvector client, migrations
│   ├── tools/                # Device agent, Gmail, Calendar, Tavily, E2B, WebView
│   ├── skills/               # Research, Coding, Brainstorming, Mermaid graphs
│   ├── gateway/              # Telegram, Discord, CarbonVoice gateways
│   ├── cron/                 # Nightly prompt consolidation & health checks
│   ├── scripts/              # Setup validator and database migration scripts
│   └── tests/                # pytest unit & integration test suites
├── client/                   # React Native (Expo SDK 57) Android Client
│   ├── app/                  # File-based routes (chat, browser, tasks, settings)
│   ├── components/           # Aurora glass UI, KaTeX, Mermaid, Code blocks, Feed
│   ├── modules/              # Native Kotlin/C++ modules:
│   │   ├── device-agent/     # Shizuku AIDL service & AccessibilityService
│   │   ├── needle/           # Needle-3 Cactus C++ engine JNI bindings
│   │   └── stable-diffusion/ # On-device Vulkan-accelerated image generator
│   ├── store/                # Zustand state stores (Chat, Config, Browser, Auth)
│   └── utils/                # SSE client, metrics ring buffer, local LLM wrappers
├── scripts/                  # UI Council scoring & Metrics regression comparators
├── docs/                     # Architectural Decision Records (ADRs) & specs
├── render.yaml               # Render Cloud Blueprint for 1-click backend deployment
└── vela_ci.py                # Single-command CI gate
```

---

## 🤝 Community & Contributing

Contributions are warmly welcomed! Please review our [Backend Contributing Guide](backend/CONTRIBUTING.md) and [Domain Architecture Model](CONTEXT.md) before submitting pull requests.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AutonomousAgentFeature`)
3. Verify your changes pass the gate: `python vela_ci.py ci`
4. Commit your Changes (`git commit -m 'Add AutonomousAgentFeature'`)
5. Push to the Branch (`git push origin feature/AutonomousAgentFeature`)
6. Open a Pull Request

---

## 📜 License

Vela is released under the **Apache-2.0** and **MIT** licenses. See [LICENSE](LICENSE) for details.

<div align="center">
<sub>Crafted with passion for personal sovereignty and sovereign intelligence.</sub>
</div>

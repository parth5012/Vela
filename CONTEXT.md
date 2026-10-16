# Vela Domain Model

Vela is a single-tenant personal assistant backend. It is designed to be self-hosted, serving a single Owner across multiple platforms (Telegram, Discord, Vela Android Client).

Vela's domain model coordinates personal assistant agent layers, conversation sessions, and external software tool mappings.

## Core Language

**Owner**:
The single human user who owns, authenticates, operates self-hosted Vela instance.
_Avoid_: User, client, account

**Conversation**:
An ongoing interaction channel (mapped to a Telegram Chat ID or Discord Channel ID) containing raw and semantic memory of past user interactions.
_Avoid_: Session, chat record

**Agent**:
A cohesive functional identity that defines the LLM instructions, active tool bindings, and specific capability constraints available to the user in a conversation.
_Avoid_: Persona, role-player, skill-set

**Active Agent**:
The specific Agent explicitly selected by the Owner for a Conversation. All messages in that Conversation are routed to this Agent until changed.
_Avoid_: Active Skill, persona setting

**Agent Tool Registry**:
The mapping that defines which specific tools are bound to a given Agent, reducing LLM token consumption and preventing unauthorized tool usage.
_Avoid_: Global toolset

**Authentication Gate**:
A security check performed within agent tools that require external service access (like Google Workspace tools). It reads saved credentials for the Conversation from the database and, if missing, aborts execution to return a clear authentication flow redirect URL to the Owner.
_Avoid_: Dynamic scopes

**Google Workspace Agent**:
A specialized Agent configured to access the Owner's Gmail and Google Calendar resources via authenticated tool bindings.
_Avoid_: Integration bot, email assistant

**Auto-Refresh Propagation**:
The mechanical process where agent tools refresh an expired Google OAuth access token using a refresh token and immediately write the updated credentials back to the database.
_Avoid_: Client-side refresh

**Golden Dataset**:
The versioned dual-oracle regression evaluation suite (`backend/evals/golden.jsonl`, schema v1) that verifies Supervisor routing, Agent Tool Registry bindings, Authentication Gate redirects, and client streaming contracts for the Owner across versions.
_Avoid_: Test bank, mock collection, eval corpus

**Eval Case**:
An atomic test fixture in the Golden Dataset declaring an incoming message, Conversation context, Active Agent, and exact dual-oracle expectations (Supervisor routing target and client streaming response).
_Avoid_: Test row, scenario item

**SSE Contract**:
The strict Server-Sent Event streaming protocol between the Vela backend and the Vela Android client for a Conversation, requiring a sequence of content chunks followed by exactly one terminal `done` event containing a non-empty `thread_title` and well-formed XML segment tags.
_Avoid_: Streaming API, chunk protocol

**Message Timestamp**:
The localized presentation of a message's creation time (`created_at`), pinned to the message bubble footer.
_Avoid_: Message clock, bubble time label

**Date Divider**:
A centered, non-interactive visual badge separating messages between different calendar days in a conversation feed.
_Avoid_: Day pill, date header, calendar section

**Day Cluster**:
A contiguous sequence of messages sent within the same calendar day in the Owner's local timezone.
_Avoid_: Daily block, message date group

**Needle Model**:
One of the two on-device Cactus `.cact` models Vela ships — `Needle-2 45M` (2048 context) and `Needle-3 (20-layer)` (8192 context) — identified by its 4-byte magic tag (`0x05E12A83` needle2, `0x05E12A84` needle3) and run by the statically linked, Apache-2.0 Needle engine. Needle-1 (26M) was decided out of scope, so "three models" is never correct.
_Avoid_: Needle lineup, 3-model family

**Local Model Format**:
The engine-specific file format of a downloadable on-device model: LiteRT `.task` (MediaPipe), GGUF (llama.rn), or `.cact` (Needle engine). Formats are not interchangeable, and no single one is the app's only format.
_Avoid_: LiteRT-only model

**Engine Pill**:
The Settings → Local AI badge stating the Needle engine's real state — `Accelerated (native)` when the native library loaded, `Mock Fallback` otherwise — so a mock is never presented as a running model.
_Avoid_: engine status dot, speed badge


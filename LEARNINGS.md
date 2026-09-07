# Learnings

Key learnings, edge cases, and concepts worth remembering for this project.

## Project-Specific Learnings

1. Vela is a single-tenant (one Owner) personal assistant: Telegram, Discord, and Expo/React Native Android client all talk to one FastAPI backend.
2. Backend runtime is Python 3.11 managed with `uv` (see `backend/pyproject.toml`). Run everything through `uv run` or bare `python`.
3. The supervisor pattern uses LangGraph; intents are classified by `agent/router.py` and routed to tools or multi-turn skills (`agent/graph.py`).
4. Memory is server-side and semantic: Supabase PostgreSQL with pgvector, 512-dim embeddings (`backend/db/supabase.py`, `db/schema.sql`).
5. Client is a single Expo project under `client/` (not a monorepo). Has lint/format scripts configured and typecheck via `npx tsc --noEmit`.
6. ADB-connected device is the user's personal phone (MIUI). `adb shell input` is blocked, so UI automation is not an option; prefer read-only inspection.

## Decision Log

Why decisions were made, alternatives considered, consequences.

- **Needle Expo Module Fallback Architecture**: When building `client/modules/needle`, CMake checks for `src/main/jniLibs/${ANDROID_ABI}/libneedle.so`. If present (arm64-v8a device), it links the native library and sets `HAVE_NEEDLE_SO=1`. If missing (x86_64 emulator or test runner), it sets `HAVE_NEEDLE_SO=0` and compiles a deterministic mock fallback stub, preventing build breakage while enabling full testability.
- **Universal LocalAgentLoop**: Designed streaming buffer to detect both Needle JSON tool calls and XML tool tags on-device. Evaluates safety with `safetyManager` and executes actions via Android Accessibility / DeviceAgentNative with recursion capped at 5 turns without network transit.
- **Idempotent Device Step Sync**: Offline turns buffer in Drizzle SQLite `operationLog` and synchronize to `POST /api/sync/device-steps` with source gating (`conv.source == "android_client"`) and idempotent upserting into `SyncMessage` and `ToolInvocation`.

## Edge Cases

Known edge cases, gotchas, non-obvious behaviors discovered during work.

- **HTTP Range Preflight vs OOM**: When preflighting model magic bytes with `Range: bytes=0-15`, some remote servers ignore the Range header and return HTTP 200 with the full content length. Always guard against `response.arrayBuffer()` buffering multi-gigabyte models into mobile memory by checking status, content-length, and reader streaming.
- **Path Traversal in Model Filenames**: Naive regex `replace(/[^a-zA-Z0-9._-]/g, '_')` preserves `..`. Basename isolation via `fileName.split(/[\/\\]/).pop()` plus explicit `..` stripping is required before constructing destination storage paths.
- **JNI Null Dereference & CheckJNI Abort**: In JNI native modules, calling `GetStringUTFChars` on null `jstring` or calling `ReleaseStringUTFChars` with null pointers triggers immediate `SIGABRT` crashes under Android's CheckJNI. Always guard with null checks before string conversion.
- **Cross-Source Sync Ingestion Protection**: `/api/sync/device-steps` must validate `conv.source == "android_client"` to prevent unauthorized injection into external channels (Telegram/Discord).

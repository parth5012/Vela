# Tool-Based Long-Term Semantic Memory Design

## 1. Context
To provide the supervisor agent with explicit control over long-term semantic memory, we will implement memory management operations as LangChain tools. This replaces the silent background thread with active tool-calling, allowing the agent to save, update, and delete memories deterministically.

## 2. Proposed Changes

### 2.1 Memory Tools (`tools/memory.py`)
Implement the following `@tool` decorated functions:
- `save_user_memory(conversation_id: str, fact: str) -> str`:
  - Generates a 768-dimensional embedding for `fact` using `GoogleGenerativeAIEmbeddings`.
  - Queries the database for any highly similar memory (cosine distance < 0.35).
  - Performs LLM reconciliation (Duplicate/Conflict/Refinement) and updates the database.
  - Returns a confirmation string.
- `delete_user_memory(conversation_id: str, fact: str) -> str`:
  - Generates an embedding for `fact`.
  - Finds the closest memory and deletes it if cosine distance < 0.35.
  - Returns a confirmation string.

### 2.2 Graph Integration (`agent/graph.py`)
- Import the memory tools and add them to `tools_list` in `tools/__init__.py`.
- Pass `db_conv_id` explicitly into the system prompt template under the title `[Metadata]` so the LLM has access to the active conversation ID.
- Register the tools node to allow the LLM to route memory queries and writes.

## 3. Detailed Prompt Injection
We will update `build_system_prompt` in `agent/graph.py` to include:
```
[Metadata]
Active Conversation ID: {db_conv_id}
```

## 4. Verification Plan
- Write integration tests in `tests/test_tools.py` verifying that invoking `save_user_memory` and `delete_user_memory` performs the correct database reads/writes.
- Run `pytest` to ensure the full test suite remains green.

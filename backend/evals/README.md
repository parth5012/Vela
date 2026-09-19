# Vela Golden Dataset (v1)

The Vela Golden Dataset is a dual-oracle regression prevention eval suite. It stops Supervisor routing and Android SSE streaming regressions before they reach production.

Every case asserts both:
1. **Supervisor Route & Tool Binding**: Exact intent classification, agent selection, tool invocation, and authentication gate behavior.
2. **Android SSE Streaming Contract**: Strict chunk sequence (`content* -> single done`), non-empty `thread_title`, and well-formed XML tool/thought/intent segments without truncation or split tags.

---

## Schema Specification (`schema_version: 1`)

Each line in `backend/evals/golden.jsonl` is a self-contained JSON object with the following envelope:

```json
{
  "schema_version": 1,
  "id": "routing_001",
  "family": "routing_ambiguity",
  "input": {
    "message": "What is the capital of France?",
    "persona": "personal assistant",
    "thread_history": [],
    "auth_state": {
      "google_workspace": true
    }
  },
  "expected_supervisor": {
    "route": "chatbot",
    "tool_name": null,
    "arg_constraints": {},
    "auth_gate_behavior": null
  },
  "expected_sse": {
    "chunk_sequence": ["content*", "done"],
    "done.thread_title required": true,
    "xml segments well-formed": true
  }
}
```

### Field Definitions

| Field | Type | Description |
|---|---|---|
| `schema_version` | integer | Envelope schema version (currently `1`). |
| `id` | string | Unique identifier in format `<family_prefix>_<NNN>` (e.g. `routing_001`, `auth_001`). Never reused. |
| `family` | string | One of the 7 edge case families (see below). |
| `input.message` | string | Incoming user prompt or command. |
| `input.persona` | string \| null | Target persona/agent (`"personal assistant"`, `"teacher"`, `"prompt builder"`, `"device_agent"`, etc.). |
| `input.thread_history` | list[dict] | Prior turn history, each turn containing `{"role": "user"\|"assistant", "content": "..."}`. |
| `input.auth_state` | dict | Service connection state, e.g. `{"google_workspace": true\|false}`. |
| `expected_supervisor.route` | string | Expected supervisor destination: `"chatbot"`, `"skills"`, or node name. |
| `expected_supervisor.tool_name` | string \| null | Expected bound tool to be invoked (e.g. `"gmail"`, `"calendar"`, `"web_search"`), or `null`. |
| `expected_supervisor.arg_constraints`| dict | Key-value constraints or type requirements for tool arguments. |
| `expected_supervisor.auth_gate_behavior` | string \| null | `"pass"`, `"redirect"`, or `null`. `"redirect"` indicates the tool must halt on missing OAuth tokens. |
| `expected_sse.chunk_sequence` | list[string] | Expected chunk types in order. Supports wildcard `*` (e.g. `["content*", "done"]` or `["content*", "auth_required*", "done"]`). |
| `expected_sse.done.thread_title required` | boolean | If `true`, the terminal `done` event must contain a non-empty `thread_title`. |
| `expected_sse.xml segments well-formed` | boolean | If `true`, all `<call:NAME input="...">...</call:NAME>`, `<thought>`, and `<intent>` tags must be properly nested and closed. |

---

## Edge Families

The eval suite partitions ~70 cases across 7 distinct edge families:

1. **`routing_ambiguity`** (#267): Skill activation vs normal conversational intent, ambiguous tool invocation queries.
2. **`auth_gate`** (#268): Missing tokens, OAuth token refresh propagation, Google Workspace redirect events.
3. **`memory_isolation`** (#269): Thread isolation, semantic recall, context window budgeting.
4. **`skill_interruption`** (#270): Mid-skill cancellation ("stop", "cancel"), switching between skills, resuming conversation.
5. **`hostile_inputs`** (#271): Prompt injections, forged tool XML tags, multilingual queries, adversarial formatting.
6. **`sse_streaming`** (#272): Android client SSE stream stability, keeping alive across long tools, chunk boundary safety.
7. **`infra_failure`** (#273): Upstream LLM timeouts, database disconnects, graceful fallback and recovery.

---

## Validation & Verification

All test cases are exercised via `backend/tests/test_golden.py`:

```bash
cd backend
uv run python -m pytest tests/test_golden.py -v
```

The runner:
- Validates the JSONL schema of every case.
- Executes the Supervisor graph and SSE generator with mock providers (no live API keys required).
- Asserts route, tool call, and auth-gate responses.
- Runs `evals.validate_sse.assert_valid_sse` to strictly enforce the SSE streaming contract.

---

## Continuous Integration & Nightly Grading

1. **PR CI (`.github/workflows/ci.yml`)**:
   - Runs `backend/tests/test_golden.py` using mocked LLM responses, Supabase pgvector, and OAuth state.
   - Executes in under 5 minutes without requiring external secrets or live API keys.
   - Enforces exact match on route, tool selection, auth redirection, and strict SSE schema.

2. **Nightly Live Evaluation (`.github/workflows/eval-nightly.yml`)**:
   - Executes scheduled daily runs against live models.
   - Uses an independent OpenRouter LLM-as-a-Judge (`meta-llama/llama-3.3-70b-instruct`) implemented in `backend/evals/judge.py`.
   - Passing threshold is judge score $\ge 4/5$.
   - Strictly avoids Gemini self-grading.

---

## Maintenance & Incident Rule

When a production router misroute or Android SSE streaming incident occurs:
1. **Reproduce First**: Before closing the incident or applying fixes, add at least one new versioned eval case (`<family>_NNN`) to `backend/evals/golden.jsonl`.
2. **Immutable IDs**: Case IDs are permanent and must never be deleted or reassigned.
3. **Envelope Changes**: Any modifications to the schema envelope require incrementing `schema_version`.
4. **Negative Verification**: Verify the new case fails on unpatched code and passes on the resolved implementation.

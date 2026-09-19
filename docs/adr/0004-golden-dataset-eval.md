# ADR-0004: Versioned Golden Dataset and Dual-Oracle Regression Evaluation

## Status
Accepted

## Date
2026-09-19

## Context
Vela is a single-tenant personal assistant backend (FastAPI + LangGraph Supervisor) serving one Owner across Telegram, Discord, and an Expo/React Native Android client. In production, small modifications to prompts, tool configurations, or LLM providers frequently caused two classes of regressions:
1. **Supervisor Routing & Intent Drift**: Inadvertent skill activations, tool execution collisions (e.g. attempting code authoring before reading emails), missing Authentication Gate enforcement on Google Workspace resources, or cross-thread memory leakage.
2. **Android Client Streaming Breaches**: Server-Sent Event (SSE) format errors, unclosed or split XML tool segments (`<call:NAME ...>...</call:NAME>`), and missing `thread_title` attributes on terminal `done` events which leave the client app hung in an infinite loading state.

## Decision

We establish a versioned dual-oracle evaluation framework:

1. **Dual-Oracle JSONL Envelope (`schema_version: 1`)**:
   Every case in `backend/evals/golden.jsonl` defines two independent oracle contracts:
   - **Supervisor Oracle**: Asserts the exact routing decision (`route`), expected tool binding (`tool_name`), argument constraints, and authentication gate behavior (`redirect` vs `pass`).
   - **Android SSE Oracle**: Asserts strict event chunk sequencing (`content* -> single done`), mandatory terminal non-empty `thread_title`, and well-formed, non-truncated XML segments (`<call:NAME>`, `<thought>`, `<intent>`).

2. **Hybrid Grading Strategy**:
   - **Exact-Match**: Applied to structural invariants: routing destination, selected tool name, authentication gate redirection, and SSE schema validity.
   - **Tolerant Semantic Match**: Applied to natural language content, formatting nuances, and argument contents, while enforcing zero PII leakage.

3. **Two-Tier Execution Pipeline**:
   - **PR CI (Fast & Mocked)**: Every pull request runs `backend/tests/test_golden.py` using mocked LLM, Supabase pgvector, and OAuth responses (<5 minutes, zero external API keys or secrets required).
   - **Nightly Live Evaluation**: A scheduled workflow exercises real Gemini and fallback providers against edge subsets, using an independent OpenRouter LLM-as-a-Judge (`meta-llama/llama-3.3-70b-instruct`) with a pass threshold of $\ge 4/5$. Gemini is strictly forbidden from self-grading.

4. **Scope Exclusions**:
   - Telegram webhooks and Discord command gateways are excluded from this dataset as their protocol contracts are static and stable.
   - Android native UI rendering and theme tokens are tested via Jest/E2E in the client workspace.

5. **Incident-Driven Maintenance Rule**:
   - Any production router misroute or SSE parsing incident must append at least one versioned test case (`<family>_NNN`) to `backend/evals/golden.jsonl` before the corresponding incident issue can be closed. Case IDs are immutable and never reused.

## Consequences

- **Positive**:
  - Eliminates silent Supervisor routing regressions and stream-freezing SSE breaks.
  - Enables parallel development of edge families without merge conflicts.
  - Zero external dependency costs in PR CI.
- **Negative**:
  - Requires maintaining fixture envelopes when adding new Supervisor capabilities or tool bindings.

# Local Model Fixture Decision

> Ticket #205 — Research Resolution

## Decision: Mock-labeled fallback for E2E, real for smoke only

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| Real `.task` bundle on emulator | Tests actual inference | Emulator disk limited, MediaPipe version floor, non-deterministic output |
| Mock-labeled fallback | Deterministic, no disk issues, fast | Doesn't test real inference |
| **Hybrid (chosen)** | Best of both: fast E2E + real smoke test | Slightly more complex |

### Rationale

1. **Emulator disk constraints**: Real `.task` bundles (400MB–2GB) consume significant emulator disk space. Running all 4 models is impractical.
2. **MediaPipe version floor**: `tasks-genai 0.10.24+` is required; older versions crash natively. The emulator image may not have the right version.
3. **Determinism**: E2E tests need deterministic output for assertions. Real LLM inference is non-deterministic.
4. **Mock fallback is honest**: The app already labels mock output as mock (PRODUCT.md: "mock output is labeled as mock, never mistaken for a running model"). This is the committed behavior.

### Implementation

**E2E verification (this map)**:
- Use mock-labeled fallback for all E2E tests
- Mock server returns deterministic response when local mode is active
- Assertion: UI shows "mock" label, response text matches fixture

**Smoke test (separate, optional)**:
- Install one small model (SmolLM, 400MB) on emulator
- Verify real inference produces non-empty output
- Run once per CI cycle, not per E2E pass

### Fixture Update

The `local-ai.json` fixture should include:
```json
{
  "local_mode_response": {
    "type": "mock",
    "label": "Mock Local Response",
    "delta": "[MOCK] This is a simulated local inference response."
  }
}
```

### Implications for Spec

- E2E oracle for Local AI checks for mock label presence, not inference quality
- Real inference smoke test is out of scope for this map
- If emulator disk becomes available, the hybrid can升级 to real `.task` bundles later

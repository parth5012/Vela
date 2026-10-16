# Vela System-Level Evaluation Pipelines

## Overview

Seven independent system-level eval pipelines that test Vela's capabilities with **real model calls** and framework-appropriate assertions. Separate from the application-level golden dataset (`backend/evals/`), which tests supervisor routing and SSE contracts with mocked providers.

**Status:** Built but disabled by default. Enable via `VELA_SYSTEM_EVALS_ENABLED=1`.

## Taxonomy

| # | Family | Framework | Runner | What it measures |
|---|---|---|---|---|
| 1 | `safety` | Promptfoo | `promptfoo eval` | Prompt injection resistance, PII leakage, jailbreak resilience, refusal accuracy, adversarial input handling |
| 2 | `multi-turn` | DeepEval | `deepeval test run` | Context coherence across turns, contradiction detection, conversation relevancy, thread isolation |
| 3 | `tool-calling` | DeepEval | `deepeval test run` | Correct tool selection, argument accuracy, tool sequencing, auth gate routing, negative precision |
| 4 | `cost-latency` | Custom + LangSmith | `python -m runner` | Token usage per turn, $/conversation, p50/p95 latency, model fallback overhead, budget alerts |
| 5 | `browser-automation` | DeepEval | `deepeval test run` | Task completion rate, step efficiency, DOM action accuracy, navigation loop detection, trajectory quality |
| 6 | `phone-automation` | Promptfoo | `promptfoo eval` | Intent→ADB action mapping, Shizuku permission handling, OCR accuracy, action space correctness |
| 7 | `workspace-automation` | DeepEval | `deepeval test run` | Multi-step Gmail & Calendar flows, side-effect safety, OAuth refresh handling, idempotency & confirmations |
| 8 | `memory` | RAGAS | `python -m runner` | pgvector retrieval precision/recall, faithfulness of memory-grounded answers, context relevancy |

## Architecture

```
system-evals/
├── ARCHITECTURE.md              ← this file
├── conftest.py                  ← shared pytest fixtures (auth states, conversation histories, tool mocks)
├── config.py                    ← shared model config, API keys, enable gate, cost thresholds
├── runner.py                    ← CLI dispatcher: ./runner.py --family safety --mode nightly
├── requirements.txt             ← deepeval, ragas, promptfoo deps
├── pyproject.toml               ← uv project config
│
├── safety/
│   ├── promptfoo.yaml           ← red-team config, adversarial generators, OWASP probes
│   ├── datasets/
│   │   ├── injections.yaml      ← prompt injection test cases
│   │   ├── pii_leakage.yaml     ← PII/secret detection cases
│   │   ├── jailbreaks.yaml      ← jailbreak resistance cases
│   │   └── forgery.yaml         ← forged XML/tool tag cases
│   ├── providers/
│   │   └── vela_provider.py     ← custom promptfoo provider hitting Vela's /chat/message
│   └── assertions/
│       └── safety_checks.py     ← custom assertion functions (no-exfil, no-pii-echo, refusal-present)
│
├── multi_turn/
│   ├── test_multi_turn.py       ← DeepEval ConversationalTestCase tests
│   ├── datasets/
│   │   ├── recall_accuracy.json       ← "what did I say about X?" cases with seeded history
│   │   ├── contradiction.json         ← preference override / correction cases
│   │   ├── thread_isolation.json      ← cross-thread leakage detection
│   │   └── context_window.json        ← long-context degradation cases
│   └── metrics/
│       └── coherence.py         ← custom DeepEval metrics for turn-over-turn coherence
│
├── tool_calling/
│   ├── test_tool_calling.py     ← DeepEval ToolCorrectnessMetric tests
│   ├── datasets/
│   │   ├── selection.json       ← correct tool picked for intent
│   │   ├── arguments.json       ← argument shape/value accuracy
│   │   ├── sequencing.json      ← multi-tool orchestration order
│   │   └── negative.json        ← cases where NO tool should be called
│   └── mocks/
│       └── tool_interceptor.py  ← intercepts tool execution, captures call signature, returns canned response
│
├── cost_latency/
│   ├── runner.py                ← standalone runner (no framework — custom instrumentation)
│   ├── benchmarks/
│   │   ├── synthetic_turns.json ← standardized prompts for latency measurement
│   │   └── budget_profiles.json ← token budget thresholds per persona/model
│   ├── collectors/
│   │   ├── langsmith.py         ← pull token counts + timing from LangSmith traces
│   │   ├── timer.py             ← wall-clock measurement wrapper
│   │   └── cost_model.py        ← $/1K token pricing lookup per provider
│   └── thresholds.py            ← p50/p95 latency limits, max $/turn, alert rules
│
├── browser_automation/
│   ├── test_browser.py          ← DeepEval GEval trajectory tests
│   ├── datasets/
│   │   ├── trajectories/        ← recorded session step logs (DOM snapshots + actions)
│   │   ├── tasks.json           ← task descriptions with expected outcomes
│   │   └── failure_patterns.json← known anti-patterns (nav loops, selector timeouts)
│   └── metrics/
│       ├── task_completion.py   ← binary success + step efficiency score
│       └── trajectory_quality.py← navigation loop detection, DOM action accuracy
│
├── phone_automation/
│   ├── promptfoo.yaml           ← deterministic intent→action assertion tests
│   ├── datasets/
│   │   ├── adb_actions.yaml     ← intent-to-ADB-command mapping cases
│   │   ├── shizuku.yaml         ← permission gate cases
│   │   └── ocr.yaml             ← text extraction accuracy cases (Gboard scan text)
│   ├── providers/
│   │   └── device_agent_provider.py ← provider calling device_agent tool with mock ADB
│   └── assertions/
│       └── action_match.py      ← exact action + target assertions
│
├── workspace_automation/
│   ├── test_workspace.py        ← DeepEval ToolCorrectness + GEval workflow tests
│   ├── datasets/
│   │   ├── email_triage.json    ← read inbox -> filter -> draft response workflows
│   │   ├── calendar_sync.json   ← conflict detection -> schedule -> invite workflows
│   │   ├── cross_tool_flow.json ← email content -> calendar event -> confirmation email
│   │   └── auth_boundary.json   ← token expiration recovery during multi-step execution
│   └── mocks/
│       └── google_workspace_mock.py ← mock Gmail & Calendar API state machine
│
└── memory/
    ├── runner.py                ← RAGAS pipeline runner
    ├── datasets/
    │   ├── retrieval.json       ← query + expected retrieved passages from pgvector
    │   ├── faithfulness.json    ← query + context + expected answer (did model use context?)
    │   └── relevancy.json       ← query + retrieved docs (are the docs actually relevant?)
    ├── adapters/
    │   └── pgvector_adapter.py  ← wraps Vela's memory search as a RAGAS retriever
    └── metrics.py               ← RAGAS metric config: context_precision, context_recall, faithfulness, answer_relevancy
```

## Shared Config (`config.py`)

```python
import os

# Master gate — all system evals are disabled until production
SYSTEM_EVALS_ENABLED = os.getenv("VELA_SYSTEM_EVALS_ENABLED", "0") == "1"

# Model config — single source of truth
EVAL_MODEL = os.getenv("VELA_EVAL_MODEL", "gemini-2.5-flash")
JUDGE_MODEL = os.getenv("VELA_JUDGE_MODEL", "meta-llama/llama-3.3-70b-instruct")

# API keys
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
GOOGLE_AI_API_KEY = os.getenv("GOOGLE_AI_API_KEY")

# Cost thresholds
MAX_COST_PER_TURN_USD = float(os.getenv("VELA_MAX_COST_PER_TURN", "0.05"))
P95_LATENCY_MS = int(os.getenv("VELA_P95_LATENCY_MS", "5000"))

# LangSmith
LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "vela-system-evals")
```

## CLI Dispatcher (`runner.py`)

```
Usage:
  python runner.py --family safety             # run one family
  python runner.py --family all                 # run all families
  python runner.py --family safety --mode smoke # PR CI smoke subset (<5 cases)
  python runner.py --family all --mode nightly  # full nightly sweep
  python runner.py --family cost-latency --live # force-enable even if gate is off
```

## Run Cadence

| Trigger | What runs | Gate |
|---|---|---|
| **PR CI** | Smoke subset — ≤5 cases per family, fast assertions only | `VELA_SYSTEM_EVALS_ENABLED=1` (disabled by default) |
| **Nightly** | Full sweep — all cases, real model calls, LLM-as-Judge grading | `VELA_SYSTEM_EVALS_ENABLED=1` (disabled by default) |
| **On-demand** | `--family <name> --live` bypasses the gate for local iteration | Always available |

## CI Integration (disabled by default)

```yaml
# .github/workflows/system-evals.yml
name: System-Level Evals (Nightly)

on:
  schedule:
    - cron: '0 3 * * *'       # 3 AM UTC daily
  workflow_dispatch:
    inputs:
      family:
        description: 'Eval family to run (or "all")'
        default: 'all'

env:
  VELA_SYSTEM_EVALS_ENABLED: ${{ vars.SYSTEM_EVALS_ENABLED || '0' }}

jobs:
  eval-matrix:
    if: env.VELA_SYSTEM_EVALS_ENABLED == '1'
    strategy:
      fail-fast: false
      matrix:
        family: [safety, multi-turn, tool-calling, cost-latency, browser-automation, phone-automation, workspace-automation, memory]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv sync --project system-evals
      - run: |
          cd system-evals
          python runner.py --family ${{ matrix.family }} --mode nightly
      - uses: actions/upload-artifact@v4
        with:
          name: eval-report-${{ matrix.family }}
          path: system-evals/reports/${{ matrix.family }}/
```

## Framework Versions (pinned)

| Framework | Version | Purpose |
|---|---|---|
| `deepeval` | `>=2.1` | Multi-turn, tool calling, browser automation, workspace |
| `ragas` | `>=0.2` | Memory retrieval evaluation |
| `promptfoo` | `>=0.100` | Safety red-team, phone automation assertions |
| `langsmith` | `>=0.2` | Cost/latency trace collection |

## Metrics per Family

### Safety (Promptfoo)
- Injection resistance rate (% of injections correctly refused)
- PII echo rate (% of PII-containing inputs where PII appears in output — target: 0%)
- Jailbreak success rate (target: 0%)
- Forged tag execution rate (target: 0%)

### Multi-Turn (DeepEval)
- `ConversationalRelevancyMetric` — is the response relevant given full conversation?
- `ContextualRecallMetric` — does the model recall seeded facts from earlier turns?
- Custom `CoherenceMetric` — does the model contradict itself across turns?
- Thread isolation score — does info leak across thread boundaries?

### Tool Calling (DeepEval)
- `ToolCorrectnessMetric` — correct tool name + argument shape
- Selection precision — right tool out of N available
- Negative precision — correctly NOT calling a tool when none is appropriate
- Sequencing accuracy — multi-tool calls in correct dependency order

### Cost & Latency (Custom)
- Token count per turn (input + output)
- $/turn by persona and model
- p50/p95 wall-clock latency (ms)
- Model fallback frequency and cost delta
- Budget breach alerts

### Browser Automation (DeepEval)
- Task completion rate (binary)
- Step efficiency — actual steps / optimal steps
- `GEval` trajectory quality score (1–5)
- Navigation loop detection rate
- DOM action accuracy — correct selector + action type

### Phone Automation (Promptfoo)
- Intent→action exact match rate
- ADB command correctness (action + target + value)
- Shizuku permission gate accuracy
- OCR text extraction accuracy (Levenshtein / exact match)

### Workspace Automation (DeepEval)
- Multi-step task completion rate (read email -> schedule calendar -> send confirm)
- Tool parameter accuracy for Gmail & Calendar API schemas
- Side-effect safety (refusal of unconfirmed destructive actions like bulk email deletion or unprompted emails)
- OAuth token expiration handling and graceful recovery during multi-step execution

### Memory (RAGAS)
- `context_precision` — are retrieved passages actually needed?
- `context_recall` — are all needed passages retrieved?
- `faithfulness` — does the answer only use info from retrieved context?
- `answer_relevancy` — is the answer relevant to the query?

## Relationship to Existing Evals

```
backend/evals/                  ← APPLICATION-LEVEL (stays as-is)
  golden.jsonl                  ← 71 cases, mocked providers, regression prevention
  judge.py                      ← OpenRouter LLM-as-Judge for nightly live runs
  report/                       ← HTML dashboard

system-evals/                   ← SYSTEM-LEVEL (new, this document)
  8 families                    ← real model calls, framework-specific assertions
  3 frameworks                  ← DeepEval, RAGAS, Promptfoo
  shared config                 ← single model/key/threshold source of truth
```

The two suites are complementary:
- **Application evals** catch routing/SSE/schema regressions fast, in every PR, with zero cost.
- **System evals** measure real capability quality — does safety actually hold? Does memory actually recall? Is latency acceptable? Run when enabled, on schedule or on-demand.

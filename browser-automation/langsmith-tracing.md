# LangSmith Instrumentation & Dashboards

Vela integrates with **LangSmith** to monitor execution flows and trace the execution path of autonomous web tasks. Every browser step is instrumented using LangSmith's `@traceable` SDK.

## Trace Names & Spans Structure

When the agent runs an automation task, it creates a hierarchical trace tree:

```
[Tool] WebView Action: navigate  (Parent Span)
  |
  +-- [Chain] DB: Log Action Start  (Child Span)
  |
  +-- [Chain] Wait for Client WebView Event  (Child Span)
  |
  +-- [Chain] DB: Log Action Completion  (Child Span)
```

### 1. `WebView Action: {action}` (Parent Span)
* **Type**: `tool`
* **Tags**: `["webview", "browser-automation"]`
* **Purpose**: This traces the invocation of the browser tool. The label updates dynamically with the action name (e.g. `WebView Action: click`, `WebView Action: extract_dom`) to make it easily searchable.

### 2. `DB: Initialize Automation Step` (Child Span)
* **Type**: `chain`
* **Tags**: `["webview", "database"]`
* **Purpose**: Measures the latency of checking active sessions and saving the initial pending step into the Supabase database.

### 3. `Wait for Client WebView Event` (Child Span)
* **Type**: `chain`
* **Tags**: `["webview", "network"]`
* **Purpose**: Tracks the duration during which the backend blocks on the `asyncio.Event` waiting for the physical mobile device to run the action and POST the response back. This isolates mobile network and loading latency from server-side execution latency.

### 4. `DB: Save Step Results` (Child Span)
* **Type**: `chain`
* **Tags**: `["webview", "database"]`
* **Purpose**: Traces updating the database step log with the outcome returned from the device.

---

## Standalone Evaluation Traces

Since evaluation runs asynchronously in a background thread after the client's SSE response completes, it is traced as its own root-level run.

### `WebView Trajectory Evaluation`
* **Type**: `chain`
* **Tags**: `["webview", "evaluation"]`
* **Purpose**: Logs the execution of the evaluation agent. It captures the formatted trajectory of steps presented to the LLM, the LLM evaluator's latency, and the parsed JSON evaluation verdict. This keeps evaluation outputs visible in the dashboard without cluttering active chat stream traces.

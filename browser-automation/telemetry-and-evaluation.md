# Observability Database & LLM Trajectory Evaluation

To monitor and evaluate the performance of the browser agent, Vela logs every step of a browser automation session into a structured relational schema in Supabase. When a session ends, an evaluation agent reviews the trajectory to rate its success and quality.

## Supabase Telemetry Schema

The database setup uses two tables, `webview_automation_sessions` (to track the overall task) and `webview_automation_steps` (to track individual actions).

### 1. Sessions Table
```sql
CREATE TABLE IF NOT EXISTS webview_automation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    task_description TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'running' NOT NULL,
    is_success BOOLEAN,
    eval_score FLOAT,
    eval_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

### 2. Steps Table
```sql
CREATE TABLE IF NOT EXISTS webview_automation_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES webview_automation_sessions(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    page_url TEXT,
    dom_snapshot JSONB,
    agent_thoughts TEXT,
    action VARCHAR(50) NOT NULL,
    target TEXT,
    value TEXT,
    status VARCHAR(20) NOT NULL,
    observation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

---

## Trajectory Evaluation Loop

Once the LangGraph supervisor completes a chat iteration (when the event queue finishes streaming), a background worker task evaluates the trajectory.

### The Evaluation Function
The `evaluate_webview_session` function (in `tools/webview_browser.py`) gathers all logged steps for the session, builds a trajectory history trace, and presents it to the LLM (Gemini 2.5 Flash) with an evaluation prompt:

```python
async def evaluate_webview_session(session_id: str):
    # Queries DB for session + steps
    # Formats trajectory block...
    
    eval_prompt = f"""You are an expert AI Agent Evaluator. Review the following trajectory of a browser automation agent and evaluate if it successfully completed the user's task.

### User Task:
"{session.task_description}"

### Trajectory of Steps:
{trajectory}

### Instructions:
Assess the run based on these criteria:
1. **Success**: Did the agent achieve the user's ultimate goal? (TRUE/FALSE)
2. **Score**: Rate the efficiency and correctness on a scale from 1.0 (failed or completely wrong) to 5.0 (perfect, fast, and correct).
3. **Rationale**: Summarize the reasoning behind your score, including issues like element selection failures, navigation loops, or timeouts.

Respond ONLY with a JSON block.
Example:
{{"is_success": true, "eval_score": 4.5, "eval_reason": "Explanation..."}}
"""
    llm = get_llm()
    response = await llm.ainvoke(eval_prompt)
    # Parses JSON and stores is_success, eval_score, and eval_reason in DB
```

---

## Continuous Self-Improvement integration
Because all sessions, steps, DOM snapshots, and evaluator scores are persisted in structured tables:
1. The **Vela Consolidation Cron** (`consolidate.py`) queries failed runs (`is_success = False` or `eval_score < 3.0`) during the nightly consolidation window.
2. The consolidation agent reviews the step logs and observations to find weaknesses (e.g. repeated selector timeouts).
3. It updates the dynamically injected system prompts to teach the agent to handle similar dynamic elements or navigation traps better.
4. The updated guidelines are saved to the `system_prompt_fragments` table, completing the feedback loop.

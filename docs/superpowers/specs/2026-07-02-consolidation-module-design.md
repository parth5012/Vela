# Self-Improvement Consolidation Module Design

## 1. Context
The Supervisor Agent keeps a log of user interactions and evaluations in the `experiences` table. To enable continuous self-improvement, we need to implement a nightly consolidation cron job that retrieves recent, unconsolidated experiences, packages them for the LLM to analyze, and updates the agent's system prompt guidelines (`system_prompt_fragments` table). The agent must then dynamically load these updated guidelines into its system prompt.

## 2. Proposed Changes

### 2.1 Dynamic Prompt Assembly (`agent/graph.py`)
- Load `dynamic_rules` from the `system_prompt_fragments` table.
- If found, inject the fragment content into the system prompt under a `# Dynamic Rules` header.
- If not found, use a default empty string or starting placeholder to ensure backward compatibility.

### 2.2 Consolidation Loop (`cron/consolidate.py`)
- Load all unconsolidated experiences from the database.
- If none exist, terminate early.
- Format the experiences into a detailed text report.
- Load the existing `dynamic_rules` fragment from the database.
- Execute an LLM query using `ChatGoogleGenerativeAI` with a detailed self-improvement prompt.
- Save the updated rules back to the database as the `dynamic_rules` fragment.
- Mark all processed experiences as `consolidated = True`.

## 3. Detailed Design

### 3.1 LLM Prompt for Consolidation
```markdown
You are a Supervisor Self-Improvement System. Your job is to analyze recent user interaction experiences, identify conversational or technical weaknesses, and update the existing dynamic rules.

### Input Data:
1. **Existing Dynamic Rules**:
{existing_rules}

2. **Recent User Interaction Experiences (evaluated)**:
{experiences_block}

### Instructions:
- Analyze the experiences, focusing particularly on interactions with low evaluation scores.
- Determine if the agent was too verbose, mathematically incorrect, ignored instructions, lacked empathy, or was pedantic.
- Revise the "Existing Dynamic Rules" to introduce new constraints, guidelines, or style adjustments to prevent these mistakes.
- Do NOT delete existing rules unless they conflict with new guidelines or are no longer useful.
- Ensure the rules remain concise, clear, and action-oriented. Do not exceed 10 distinct guidelines.
- Output ONLY the updated rules block. Do not include markdown preamble or conversational text outside of the rules format.
```

## 4. Verification Plan
- Unit test dynamic prompt loading in `tests/test_graph.py` by mocking the database response.
- Unit test the consolidation cron loop in `tests/test_cron.py` by inserting dummy unconsolidated experiences, calling `/consolidate`, and asserting that `dynamic_rules` gets updated and the experiences are marked as consolidated.

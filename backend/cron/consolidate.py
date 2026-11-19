import os
from typing import List, Tuple
from db.session import get_db_session
from db.models import Experience, SystemPromptFragment, utcnow_naive
from utils.llm import get_llm
from utils.logger import StructuredLogger
from cron.briefing import run_daily_briefing

__all__ = [
    "run_self_improvement",
    "run_daily_briefing",
    "CONSOLIDATION_BATCH_LIMIT",
    "MAX_CONSOLIDATION_BATCHES",
    "MAX_DYNAMIC_RULES",
    "DYNAMIC_RULES_KEY",
    "DYNAMIC_RULES_BACKUP_KEY",
    "PROMPT_INJECTION_MARKERS",
    "validate_consolidated_rules",
]

logger = StructuredLogger("ConsolidatedCron")

# Wayfinder T7/finding-019: bound per-run cost and drain backlog incrementally.
# Oldest-first batch cap so an OOM-scale backlog drains in bounded batches.
CONSOLIDATION_BATCH_LIMIT = 50
MAX_CONSOLIDATION_BATCHES = 20
# Upper bound on distinct guidelines the LLM may return (mirrors the prompt).
MAX_DYNAMIC_RULES = 10

DYNAMIC_RULES_KEY = "dynamic_rules"
# Rollback copy: single bounded row holding the pre-update rules.
DYNAMIC_RULES_BACKUP_KEY = "dynamic_rules_prev"

# Case-insensitive substrings marking LLM output as prompt-injection /
# hallucinated control text — never allowed to overwrite dynamic_rules.
PROMPT_INJECTION_MARKERS = (
    "ignore previous instructions",
    "ignore all instructions",
    "ignore your instructions",
    "disregard previous",
    "disregard all prior",
    "override your",
    "you are now",
    "new instructions:",
    "system prompt",
    "reveal the system",
    "jailbreak",
    "<script",
)


def _extract_rules_text(response) -> str:
    """Coerces an LLM response into plain rules text."""
    content = getattr(response, "content", response)
    if isinstance(content, list):
        content = "\n".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content or "").strip()


def validate_consolidated_rules(updated_rules: str) -> Tuple[bool, str]:
    """Validates LLM-written prompt rules before they may overwrite state.

    Returns (True, "") when the output is non-empty, holds at most
    ``MAX_DYNAMIC_RULES`` distinct non-empty lines, and contains no
    prompt-injection markers; otherwise (False, reason).
    """
    if not updated_rules or not updated_rules.strip():
        return False, "empty LLM output"
    rules = [line.strip() for line in updated_rules.strip().splitlines() if line.strip()]
    if not rules:
        return False, "empty LLM output"
    if len(rules) > MAX_DYNAMIC_RULES:
        return False, f"{len(rules)} rules exceed limit of {MAX_DYNAMIC_RULES}"
    lowered = updated_rules.lower()
    for marker in PROMPT_INJECTION_MARKERS:
        if marker in lowered:
            return False, f"prompt-injection marker detected: {marker!r}"
    return True, ""


def run_self_improvement(max_batches: int = MAX_CONSOLIDATION_BATCHES) -> str:
    """Executes the nightly self-improvement consolidation loop in batches (#188).

    1. Fetches oldest unconsolidated experiences in batches of CONSOLIDATION_BATCH_LIMIT,
       looping until drained or max_batches (default 20) is reached.
    2. Packages each batch into a prompt containing the query, reply, and evaluation score.
    3. Calls the Gemini LLM to analyze pattern weaknesses and update dynamic prompt rules.
    4. Validates LLM output (non-empty, <=10 rules, no prompt-injection markers);
       on success saves rollback copy and overwrites 'dynamic_rules' fragment.
    5. Marks processed experiences as consolidated per-batch (transactional commits).
    6. On LLM failure: logs, leaves that batch unmarked, and exits cleanly preserving prior batches.

    Returns:
        A status string detailing the result of the consolidation.
    """
    logger.info("Starting run_self_improvement nightly cron job")
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key or api_key.startswith("your_"):
        logger.warning("GOOGLE_API_KEY is not set or is mock. Skipping consolidation.")
        return "Consolidation skipped: GOOGLE_API_KEY not configured."

    total_consolidated = 0
    batches_run = 0

    while batches_run < max_batches:
        try:
            with get_db_session() as session:
                experiences: List[Experience] = (
                    session.query(Experience)
                    .filter_by(consolidated=False)
                    .order_by(Experience.created_at.asc())
                    .limit(CONSOLIDATION_BATCH_LIMIT)
                    .all()
                )
                if not experiences:
                    break

                # Format experiences
                experiences_block = ""
                for i, exp in enumerate(experiences):
                    experiences_block += (
                        f"Experience #{i+1}:\n"
                        f"- Query: {exp.user_query}\n"
                        f"- Response: {exp.agent_response}\n"
                        f"- Eval Score: {exp.eval_score}\n"
                        f"- Eval Reason: {exp.eval_reason}\n\n"
                    )

                # Get existing rules
                existing_rules = ""
                rules_fragment = session.query(SystemPromptFragment).filter_by(key=DYNAMIC_RULES_KEY).first()
                if rules_fragment:
                    existing_rules = rules_fragment.content

                # Build Prompt
                prompt = f"""You are a Supervisor Self-Improvement System. Your job is to analyze recent user interaction experiences, identify conversational or technical weaknesses, and update the existing dynamic rules.

### Input Data:
1. **Existing Dynamic Rules**:
{existing_rules if existing_rules else "(None)"}

2. **Recent User Interaction Experiences (evaluated)**:
{experiences_block}

### Instructions:
- Analyze the experiences, focusing particularly on interactions with low evaluation scores.
- Determine if the agent was too verbose, mathematically incorrect, ignored instructions, lacked empathy, or was pedantic.
- Revise the "Existing Dynamic Rules" to introduce new constraints, guidelines, or style adjustments to prevent these mistakes.
- Do NOT delete existing rules unless they conflict with new guidelines or are no longer useful.
- Ensure the rules remain concise, clear, and action-oriented. Do not exceed 10 distinct guidelines.
- Output ONLY the updated rules block. Do not include markdown preamble or conversational text outside of the rules format.
"""

                logger.info("Triggering LLM for prompt consolidation", num_experiences=len(experiences), batch=batches_run + 1)
                llm = get_llm()
                try:
                    response = llm.invoke(prompt)
                    updated_rules = _extract_rules_text(response)
                except Exception as llm_err:
                    logger.error("LLM invocation failed during consolidation batch", batch=batches_run + 1, error=str(llm_err))
                    break

                valid, reason = validate_consolidated_rules(updated_rules)
                if not valid:
                    logger.warning(
                        "LLM consolidation output failed validation; retaining prior dynamic_rules",
                        reason=reason,
                        num_experiences=len(experiences),
                        batch=batches_run + 1,
                    )
                    if batches_run == 0:
                        return (
                            f"Consolidation skipped: LLM rules failed validation ({reason}); "
                            f"prior {DYNAMIC_RULES_KEY} retained, {len(experiences)} experiences left unconsolidated."
                        )
                    break

                # Rollback copy of prior rules (bounded single row) before overwrite.
                if rules_fragment:
                    backup = session.query(SystemPromptFragment).filter_by(key=DYNAMIC_RULES_BACKUP_KEY).first()
                    if backup:
                        backup.content = existing_rules
                        backup.updated_at = utcnow_naive()
                    else:
                        session.add(SystemPromptFragment(key=DYNAMIC_RULES_BACKUP_KEY, content=existing_rules))

                # Update database
                if not rules_fragment:
                    rules_fragment: SystemPromptFragment = SystemPromptFragment(key=DYNAMIC_RULES_KEY, content=updated_rules)
                    session.add(rules_fragment)
                else:
                    rules_fragment.content = updated_rules
                    rules_fragment.updated_at = utcnow_naive()

                # Mark experiences as consolidated
                for exp in experiences:
                    exp.consolidated = True

                total_consolidated += len(experiences)
                batches_run += 1
        except Exception as e:
            logger.error("Failed executing run_self_improvement batch", batch=batches_run + 1, error=str(e))
            if batches_run == 0:
                return f"Consolidation failed: {str(e)}"
            break

    if total_consolidated == 0:
        msg = "Consolidated 0 experiences: No new experiences found."
        logger.info(msg)
        return msg

    if batches_run <= 1:
        msg = f"Consolidated {total_consolidated} experiences and updated dynamic_rules prompt fragment."
    else:
        msg = f"Consolidated {total_consolidated} experiences across {batches_run} batches and updated dynamic_rules prompt fragment."
    logger.info(msg)
    return msg

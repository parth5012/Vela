import os
from typing import List
from datetime import datetime
from db.session import get_db_session
from db.models import Experience, SystemPromptFragment
from langchain_google_genai import ChatGoogleGenerativeAI
from utils.logger import StructuredLogger

logger = StructuredLogger("ConsolidatedCron")

def run_self_improvement() -> str:
    """Executes the nightly self-improvement consolidation loop.
    
    1. Fetches all unconsolidated experiences from the database.
    2. Packages them into a prompt containing the user query, agent reply, and evaluation score.
    3. Calls the Gemini LLM to analyze pattern weaknesses and update the dynamic prompt rules.
    4. Saves the updated rules back to the database as the 'dynamic_rules' system prompt fragment.
    5. Marks the processed experiences as consolidated.
    
    Returns:
        A status string detailing the result of the consolidation.
    """
    logger.info("Starting run_self_improvement nightly cron job")
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key or api_key.startswith("your_"):
        logger.warning("GOOGLE_API_KEY is not set or is mock. Skipping consolidation.")
        return "Consolidation skipped: GOOGLE_API_KEY not configured."

    try:
        with get_db_session() as session:
            experiences : List[Experience] = session.query(Experience).filter_by(consolidated=False).all()
            if not experiences:
                msg = "Consolidated 0 experiences: No new experiences found."
                logger.info(msg)
                return msg

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
            rules_fragment = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
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

            logger.info("Triggering LLM for prompt consolidation", num_experiences=len(experiences))
            llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=api_key)
            response = llm.invoke(prompt)
            updated_rules = response.content.strip()

            # Update database
            if not rules_fragment:
                rules_fragment :SystemPromptFragment = SystemPromptFragment(key="dynamic_rules", content=updated_rules)
                session.add(rules_fragment)
            else:
                rules_fragment.content = updated_rules
                rules_fragment.updated_at = datetime.utcnow()

            # Mark experiences as consolidated
            for exp in experiences:
                exp.consolidated = True

            session.commit()
            msg = f"Consolidated {len(experiences)} experiences and updated dynamic_rules prompt fragment."
            logger.info(msg)
            return msg
    except Exception as e:
        logger.error("Failed executing run_self_improvement cron job", error=str(e))
        return f"Consolidation failed: {str(e)}"

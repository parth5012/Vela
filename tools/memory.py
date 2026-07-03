import os
import json
from tkinter.constants import N
from langchain_core.tools import tool
from langsmith import traceable
from utils.llm import get_llm, get_embeddings
from db.session import get_db_session
from db.models import MemoryVector
from utils.logger import StructuredLogger

logger = StructuredLogger("MemoryTools")

@tool
@traceable(run_type="tool", name="Save User Memory")
def save_user_memory(conversation_id: str, fact: str) -> str:
    """Saves a permanent fact, detail, or preference about the user into long-term memory.
    
    Use this tool when:
    - The user shares personal details (e.g. name, age, demographics).
    - The user specifies details about their projects, tech stack, career goals, or hobbies.
    - The user explicitly requests you to remember or store something.
    - Break down the information into clear, independent statements.
    
    Do NOT use this tool for temporary conversational details (like questions or transient greetings).
    
    Args:
        conversation_id: The active conversation UUID (available in the system prompt metadata).
        fact: A single, clear, independent statement of the fact to remember.
        
    Returns:
        A confirmation status string confirming success.
    """
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key or api_key.startswith("your_"):
        return "Failed to save memory: GOOGLE_API_KEY is not configured."

    try:
        fact = fact.strip()
        embeddings = get_embeddings()
        new_vector = embeddings.embed_query(fact)

        with get_db_session() as session:
            # 1. Retrieve the closest matching existing memory
            existing_match :MemoryVector | None = (
                session.query(MemoryVector)
                .filter_by(conversation_id=conversation_id)
                .order_by(MemoryVector.vector.cosine_distance(new_vector))
                .limit(1)
                .first()
            )

            decision = "NONE"
            if existing_match:
                try:
                    # 2. Check relationship with LLM
                    llm = get_llm()
                    reconciliation_prompt = f"""You are a Memory Reconciliation System. Compare a newly extracted fact with an existing memory and determine if the new fact contradicts, duplicates, refines, or is completely independent of the existing memory.

Existing Memory: "{existing_match.content}"
New Fact: "{fact}"

Classification Rules:
- DUPLICATE: The new fact says the exact same thing as the existing memory.
- CONFLICT: The new fact contradicts the existing memory (e.g., year, name, or goal has changed).
- REFINEMENT: The new fact provides more detail or updates the existing memory without direct contradiction.
- NONE: The new fact is unrelated/independent.

Return ONLY one of the following classification labels: DUPLICATE, CONFLICT, REFINEMENT, NONE.
"""
                    rec_response = llm.invoke(reconciliation_prompt)
                    decision = rec_response.content.strip().upper()
                except Exception:
                    decision = "NONE"

            if decision == "DUPLICATE":
                return f"Memory not modified (duplicate of existing record: '{existing_match.content}')"
            elif decision == "CONFLICT":
                # Delete existing and insert new
                old_content = existing_match.content
                session.delete(existing_match)
                session.flush()
                new_mem = MemoryVector(conversation_id=conversation_id, content=fact, vector=new_vector)
                session.add(new_mem)
                session.commit()
                return f"Conflict resolved: Replaced old memory '{old_content}' with new fact '{fact}'"
            elif decision == "REFINEMENT":
                # Update existing content and vector
                old_content = existing_match.content
                existing_match.content = fact
                existing_match.vector = new_vector
                session.commit()
                return f"Refined memory: Updated '{old_content}' to '{fact}'"
            else:  # NONE
                new_mem = MemoryVector(conversation_id=conversation_id, content=fact, vector=new_vector)
                session.add(new_mem)
                session.commit()
                return f"Successfully saved new memory: '{fact}'"
    except Exception as e:
        logger.error("Failed to execute save_user_memory tool", error=str(e))
        return f"Failed to save memory: {str(e)}"

@tool
@traceable(run_type="tool", name="Delete User Memory")
def delete_user_memory(conversation_id: str, fact: str) -> str:
    """Removes a fact or detail from the user's long-term memory.
    
    Use this tool when the user requests you to forget, remove, or erase a detail.
    
    Args:
        conversation_id: The active conversation UUID.
        fact: The text description of the fact to delete/forget.
        
    Returns:
        A confirmation status string.
    """
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key or api_key.startswith("your_"):
        return "Failed to delete memory: GOOGLE_API_KEY not configured."

    try:
        embeddings = get_embeddings()
        new_vector = embeddings.embed_query(fact)

        with get_db_session() as session:
            existing_match = (
                session.query(MemoryVector)
                .filter_by(conversation_id=conversation_id)
                .order_by(MemoryVector.vector.cosine_distance(new_vector))
                .limit(1)
                .first()
            )

            if existing_match:
                # Confirming it's close enough (cosine distance < 0.35)
                # In pgvector CosineDistance can be queried, or we can just ask the LLM if they match,
                # or verify distance. Let's do a quick LLM verify to confirm deletion correctness.
                try:
                    llm = get_llm()
                    verify_prompt = f"""Identify if the following two facts refer to the same subject detail (e.g. matching name, hobby, project or detail to delete).
Fact 1: "{existing_match.content}"
Fact 2: "{fact}"
Return YES if Fact 1 matches or is described by Fact 2, otherwise return NO.
"""
                    res = llm.invoke(verify_prompt)
                    match = res.content.strip().upper()
                except Exception:
                    match = "YES"

                if "YES" in match:
                    deleted_content = existing_match.content
                    session.delete(existing_match)
                    session.commit()
                    return f"Successfully deleted memory: '{deleted_content}'"
            
            return f"No matching memory found to delete for: '{fact}'"
    except Exception as e:
        logger.error("Failed to execute delete_user_memory tool", error=str(e))
        return f"Failed to delete memory: {str(e)}"

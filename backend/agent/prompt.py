import asyncio
import os

from langchain_core.messages import HumanMessage

from agent.registry import AGENT_REGISTRY
from agent.state import AgentState
from db.models import Conversation, Experience, MemoryVector, SystemPromptFragment
from db.session import get_db_session
from utils.llm import get_embeddings

MAIN_PROMPT = """[Metadata]
    Active Conversation ID: {db_conv_id}
    Chat ID: {chat_id}
    
    # Saved Information  
    Description: Previously shared user context. Use only when explicitly relevant to the current query:  
    {context}
    
    **Capabilities & Identity**  
    * Identity: You are Vela, a personal AI assistant operating in the Paid tier (offering extended memory and advanced reasoning).
    * Use this identity info strictly when answering questions about who or what you are. Never let it influence non-capability responses.
    
    **Recent Messages**  
    {recent_messages}
    
    <system_instructions>
    
    <role_and_tone>
    You are an adaptive, authentic AI collaborator and knowledgeable peer. 
    * **Voice:** Warm, approachable, and direct. Balance empathy with candor—validate frustrations or efforts, but explain concepts clearly without sounding like a rigid lecturer or using conversational fluff (e.g., never open with "Great question!").
    * **Vocabulary:** Mirror the user's technical depth and register. If they write casually, respond accessibly. If they dive into deep technical architecture, match their precision. Define specialized terms inline on first use.
    * **Progressive Disclosure:** Telegram is a fast-paced mobile messaging environment. Prioritize concise, high-density responses. Give the direct answer first, add essential nuance, and ask if they want to explore the technical depths rather than generating massive walls of text upfront.
    </role_and_tone>
    
    <formatting>
    You are communicating via a Telegram bot interface. Strictly adhere to these formatting rules to ensure clean rendering and low latency:
    * **Scannability:** Break complex ideas into short bullet points or numbered lists. Use horizontal rules (`---`) or bold section headers to separate ideas instead of heavy Markdown headers (`##` or `###`), which can look bulky on mobile screens.
    * **Headings (`##`, `###`):** To create a clear hierarchy.  
    * **Horizontal Rules (`---`):** To visually separate distinct sections or ideas.  
    * **Bolding (`**...**`):** To emphasize key phrases and guide the user's eye. Use it judiciously.  
    * **Bullet Points (`*`):** To break down information into digestible lists.  
    * **Tables:** To organize and compare data for quick reference.  
    * **Blockquotes (`>`):** To highlight important notes, examples, or quotes.  
    * **Technical Accuracy:** Use LaTeX for equations and correct terminology where needed.  
    
    ---  
    <formatting>
    
    <tool_and_media_strategy>
    * **Status Updates:** If executing a tool (search, code execution, data retrieval), you may output a brief, natural status message (e.g., *"Searching for the latest specs..."*) before invoking the tool, ensuring a responsive feel.
    * **Images & Media:** When a visual is strictly necessary to identify an object or explain a complex diagram, invoke your image retrieval tool. Do not write image tags in your text response; simply refer to the image naturally once retrieved, allowing the gateway to attach the media payload.
    * **Self-Contained vs. Guided:** For closed-form queries (math, code fixes, direct facts), give the exact answer and stop. For broad or exploratory topics, provide the core explanation and end with a single, sharp follow-up question to guide the next step.
    </tool_and_media_strategy>
    
    <guardrails_and_data_privacy>
    1. **User Data Priority:** What the user says in the current conversation takes absolute precedence over historical context. Quoted statements override inferences.
    2. **Personalization:** Smoothly weave relevant user context into your answers without prefacing them with mechanical phrases like "Based on your history" or "Since you mentioned before." Treat known context as shared memory.
    3. **Sensitive Data Restriction:** Never infer or include sensitive personal data (health conditions, race, political stance, government IDs, finances, etc.) unless explicitly commanded by the user for that specific instance. Never infer sensitive attributes from search or watch history.
    4. **Safety & Policy:** Immediately refuse requests involving illegal, dangerous, or harmful acts without preaching. Address logical fallacies if a prompt forces a violative choice.
    </guardrails_and_data_privacy>
    {dynamic_rules_section}
    </system_instructions>"""



def _extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(item.get("text", ""))
            elif hasattr(item, "text"):
                parts.append(getattr(item, "text", ""))
        return "".join(parts)
    if content is None:
        return ""
    return str(content)


def build_context(state: AgentState) -> str:
    db_conv_id = state.get("db_conv_id")
    if not db_conv_id or db_conv_id == "conv-123":
        return ""
        
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key or api_key.startswith("your_"):
        return ""
        
    try:
        # 1. Get query text from last user message
        user_msg = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
        if not user_msg or not user_msg.content:
            return ""
        query_text = _extract_text(user_msg.content)
        if not query_text:
            return ""
        
        # 2. Generate embedding for query
        embeddings = get_embeddings()
        query_vector = embeddings.embed_query(query_text)
        
        # 3. Retrieve top 3 matching memories from database using cosine distance
        with get_db_session() as session:
            results = (
                session.query(MemoryVector)
                .filter_by(conversation_id=db_conv_id)
                .order_by(MemoryVector.vector.cosine_distance(query_vector))
                .limit(3)
                .all()
            )
            if not results:
                return ""
                
            formatted_memories = "\n".join([f"- {r.content}" for r in results])
            return formatted_memories
    except Exception:
        # Fail-silent for robust runtime context assembly
        return ""

def build_recent_messages(state: AgentState) -> str:
    # 1. Fetch last 5 experiences from DB as history
    history_str = ""
    db_conv_id = state.get("db_conv_id")
    if db_conv_id and db_conv_id != "conv-123":
        try:
            with get_db_session() as session:
                exps = (
                    session.query(Experience)
                    .filter_by(conversation_id=db_conv_id)
                    .order_by(Experience.created_at.desc())
                    .limit(5)
                    .all()
                )
                exps.reverse()
                for exp in exps:
                    history_str += f"Human: {exp.user_query}\nAI: {exp.agent_response}\n"
        except Exception:
            pass

    # 2. Format current messages in state
    current_str = "\n".join([f"Human: {_extract_text(msg.content)}" if isinstance(msg, HumanMessage) else f"AI: {_extract_text(msg.content)}" for msg in state['messages']])
    
    return history_str + current_str



def _fetch_agent_and_rules(db_conv_id: str, default_agent_id: str) -> tuple[str, str]:
    agent_id = default_agent_id
    dynamic_rules_section = ""
    try:
        with get_db_session() as session:
            if agent_id == "personal assistant" and db_conv_id and db_conv_id != "conv-123":
                conv = session.query(Conversation).filter_by(id=db_conv_id).first()
                if conv and conv.agent:
                    agent_id = conv.agent

            fragment = session.query(SystemPromptFragment).filter_by(key="dynamic_rules").first()
            if fragment and fragment.content:
                dynamic_rules_section = f"\n\n# Dynamic Rules\n{fragment.content}\n"
    except Exception:
        pass
    return agent_id, dynamic_rules_section


async def build_system_prompt(state: AgentState) -> str:
    context = await asyncio.to_thread(build_context, state)
    recent_messages = await asyncio.to_thread(build_recent_messages, state)
    db_conv_id = state.get("db_conv_id", "")
    chat_id = state.get("telegram_chat_id", 0)

    # Retrieve the active agent and dynamic rules from DB off the event loop
    agent_id = state.get("agent") or "personal assistant"
    agent_id, dynamic_rules_section = await asyncio.to_thread(_fetch_agent_and_rules, db_conv_id, agent_id)

    # Look up agent instructions from the formal registry
    agent_config = AGENT_REGISTRY.get(agent_id)
    persona_section = agent_config.prompt_instructions if agent_config else ""

    if persona_section:
        dynamic_rules_section += f"\n{persona_section}"

    active_skill = state.get("active_skill")
    if active_skill:
        from skills import skills
        skill_obj = next((s for s in skills if s.name == active_skill), None)
        if skill_obj:
            skill_content = await skill_obj.execute(state)
            if skill_content:
                dynamic_rules_section += f"\n\n# Active Skill Instructions\n{skill_content}\n"

    return MAIN_PROMPT.format(db_conv_id=db_conv_id, chat_id=chat_id, context=context, recent_messages=recent_messages, dynamic_rules_section=dynamic_rules_section)

import os
import json
import re
from langchain_core.messages import AIMessage, SystemMessage, HumanMessage
from langsmith import traceable
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import tools_condition, ToolNode
from utils.llm import get_llm
from db.session import get_db_session
from db.models import Conversation
from skills import skills
from tools import tools_list
from agent.state import AgentState
from agent.prompt import build_system_prompt


tools = ToolNode(tools_list)

@traceable(name='Supervisor')
def supervisor_node(state: AgentState) -> dict:
    # 1. Load active_skill from database if valid db_conv_id is set
    active_skill = state.get("active_skill")
    db_conv_id = state.get("db_conv_id")
    if db_conv_id and db_conv_id != "conv-123":
        try:
            with get_db_session() as session:
                conv = session.query(Conversation).filter_by(id=db_conv_id).first()
                if conv:
                    active_skill = conv.active_skill
        except Exception:
            pass

    # 2. Format a system classification prompt containing the descriptions of registered skills
    skills_with_descriptions = "\n".join([f"- {s.name}: {s.description}" for s in skills])
    skills_list = [s.name for s in skills]

    supervisor_prompt = f"""You are a supervisor that classifies the user's intent regarding skills.
The available skills are:
{skills_with_descriptions}

Currently active skill: {active_skill or 'None'}

Based on the conversation history (with the user's latest input being the last message), decide the user's intent:
1. "activate": The user is asking to start/use/activate one of the available skills. E.g., they ask to brainstorm, start a design, grill them, etc.
2. "deactivate": The user is explicitly asking to stop, exit, cancel, deactivate, or quit the currently active skill. E.g., "stop", "exit", "quit", "cancel".
3. "continue": A skill is currently active, and the user is continuing the conversation within that skill (answering questions, providing feedback for the skill, etc.), and not asking to deactivate or switch skills.
4. "none": No skill is currently active, and the user is not requesting to activate any skill. E.g., they are just having a normal conversation.

You must return ONLY a JSON block containing the fields 'intent' and 'skill_name'. Do not write any explanations or other text.
Allowed intents: "activate", "deactivate", "continue", "none"
Allowed skill_names: {", ".join([f'"{name}"' for name in skills_list])} or null.

Example response format:
{{"intent": "activate", "skill_name": "BrainstormingSkill"}}
"""

    # 3. Query the LLM
    llm = get_llm()
    response = llm.invoke([SystemMessage(content=supervisor_prompt)] + list(state["messages"]))
    response_content = response.content.strip()

    # 4. Parse the LLM's response robustly
    intent = "none"
    skill_name = None
    parsed = False

    json_match = re.search(r"\{.*?\}", response_content, re.DOTALL)
    if json_match:
        try:
            data = json.loads(json_match.group(0))
            if "intent" in data:
                intent = data.get("intent")
                skill_name = data.get("skill_name")
                parsed = True
        except Exception:
            pass

    # Fallback to heuristic checks if parsing fails or outputs are invalid
    if not parsed or intent not in ["activate", "deactivate", "continue", "none"]:
        user_msg = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
        user_text = user_msg.content.lower() if (user_msg and user_msg.content) else ""
        
        if active_skill and any(word in user_text for word in ["stop", "exit", "deactivate", "cancel", "quit"]):
            intent = "deactivate"
            skill_name = None
        else:
            matched_skill = None
            for s in skills:
                name_lower = s.name.lower()
                keyword = s.name.replace("Skill", "").lower()
                if keyword in user_text or name_lower in user_text:
                    matched_skill = s.name
                    break
            
            if matched_skill:
                intent = "activate"
                skill_name = matched_skill
            elif active_skill:
                intent = "continue"
                skill_name = active_skill
            else:
                intent = "none"
                skill_name = None

    # 5. Resolve new_active_skill
    new_active_skill = active_skill
    if intent == "activate":
        new_active_skill = skill_name
    elif intent == "deactivate":
        new_active_skill = None
    elif intent == "none":
        new_active_skill = None
    elif intent == "continue":
        new_active_skill = active_skill

    if new_active_skill not in skills_list:
        new_active_skill = None

    # 6. Update the DB active_skill column if changed
    if db_conv_id and db_conv_id != "conv-123":
        if new_active_skill != active_skill:
            try:
                with get_db_session() as session:
                    conv = session.query(Conversation).filter_by(id=db_conv_id).first()
                    if conv:
                        conv.active_skill = new_active_skill
                        session.commit()
            except Exception:
                pass

    return {"active_skill": new_active_skill, "next_node": "chatbot"}


    


async def chatbot_node(state: AgentState) -> dict:
    api_key = os.getenv("GOOGLE_API_KEY", "")
    response_msg = None
    
    # Extract the user's human message from history
    user_msg = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
    user_message = user_msg.content if user_msg else ""
    
    if api_key and not api_key.startswith("your_"):
        try:
            llm = get_llm().bind_tools(tools_list)
            system_prompt = await build_system_prompt(state)
            response_msg = await llm.ainvoke([
                SystemMessage(content=system_prompt)
            ] + list(state["messages"]))
        except Exception as e:
            response_msg = AIMessage(content=f"Error invoking LLM: {str(e)}")
    else:
        response_msg = AIMessage(content=f"Hello! I received your message: '{user_message}'. (Google API Key is not set, running in mock mode)")

    # Save the interaction to the experiences table in database
    # Only save if this is a final agent response (no intermediate tool calls)
    db_conv_id = state.get("db_conv_id")
    is_tool_call = bool(getattr(response_msg, "tool_calls", None))
    if db_conv_id and db_conv_id != "conv-123" and not is_tool_call:
        try:
            # 1. Log interaction experience
            with get_db_session() as session:
                from db.client import DBClient
                client = DBClient(session)
                client.save_experience(
                     conversation_id=db_conv_id,
                     user_query=user_message,
                     agent_response=response_msg.content
                )
                session.commit()
        except Exception:
            pass

    return {"messages": [response_msg], "next_node": END}

workflow = StateGraph(AgentState)
workflow.add_node("supervisor", supervisor_node)
workflow.add_node("chatbot", chatbot_node)
workflow.add_node("tools", ToolNode(tools_list))

workflow.set_entry_point("supervisor")
workflow.add_conditional_edges(
    "supervisor",
    lambda state: state["next_node"],
    {
        # "web_search": "web_search",
        "chatbot": "chatbot",
        END: END
    }
)
# workflow.add_edge("web_search", "chatbot")
workflow.add_conditional_edges("chatbot", tools_condition, {"tools": "tools", END: END})
workflow.add_edge("tools", "chatbot")
graph = workflow.compile()


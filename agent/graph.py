import os
from langchain_core.messages import AIMessage, SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import tools_condition, ToolNode
from utils.llm import get_llm
from db.session import get_db_session
from tools import tools_list
from agent.state import AgentState
from agent.prompt import build_system_prompt


# import json
# import threading



tools = ToolNode(tools_list)

def supervisor_node(state: AgentState) -> dict:
    last_msg = state["messages"][-1].content.lower()
    # if "search" in last_msg:
    #     return {"next_node": "web_search"}
    return {"next_node": "chatbot"}

# def web_search_node(state: AgentState) -> dict:
#     return {
#         "messages": [HumanMessage(content="Search results: I found some information regarding your query.")],
#         "next_node": "chatbot"
#     }

def chatbot_node(state: AgentState) -> dict:
    api_key = os.getenv("GOOGLE_API_KEY", "")
    response_msg = None
    
    # Extract the user's human message from history
    user_msg = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
    user_message = user_msg.content if user_msg else ""
    
    if api_key and not api_key.startswith("your_"):
        try:
            llm = get_llm().bind_tools(tools_list)
            system_prompt = build_system_prompt(state)
            response_msg = llm.invoke([
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
# workflow.add_node("web_search", web_search_node)
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


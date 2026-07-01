import os
from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage, AIMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_google_genai import ChatGoogleGenerativeAI

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    telegram_chat_id: int
    db_conv_id: str
    relevant_memories: list[str]
    next_node: str

def supervisor_node(state: AgentState) -> dict:
    last_msg = state["messages"][-1].content.lower()
    if "search" in last_msg:
        return {"next_node": "web_search"}
    return {"next_node": "chatbot"}

def web_search_node(state: AgentState) -> dict:
    return {
        "messages": [AIMessage(content="Search results: I found some information regarding your query.")],
        "next_node": "chatbot"
    }

def chatbot_node(state: AgentState) -> dict:
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if api_key and not api_key.startswith("your_"):
        try:
            llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=api_key)
            response = llm.invoke(state["messages"])
            return {"messages": [response], "next_node": END}
        except Exception as e:
            return {"messages": [AIMessage(content=f"Error invoking LLM: {str(e)}")], "next_node": END}
    else:
        user_message = state["messages"][-1].content
        return {
            "messages": [AIMessage(content=f"Hello! I received your message: '{user_message}'. (Google API Key is not set, running in mock mode)")],
            "next_node": END
        }

workflow = StateGraph(AgentState)
workflow.add_node("supervisor", supervisor_node)
workflow.add_node("web_search", web_search_node)
workflow.add_node("chatbot", chatbot_node)

workflow.set_entry_point("supervisor")
workflow.add_conditional_edges(
    "supervisor",
    lambda state: state["next_node"],
    {
        "web_search": "web_search",
        "chatbot": "chatbot",
        END: END
    }
)
workflow.add_edge("web_search", "chatbot")
workflow.add_edge("chatbot", END)
graph = workflow.compile()


from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

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
    return {"next_node": END}

def web_search_node(state: AgentState) -> dict:
    return {"messages": [{"role": "assistant", "content": "Search results loaded."}], "next_node": END}

workflow = StateGraph(AgentState)
workflow.add_node("supervisor", supervisor_node)
workflow.add_node("web_search", web_search_node)

workflow.set_entry_point("supervisor")
workflow.add_conditional_edges(
    "supervisor",
    lambda state: state["next_node"],
    {
        "web_search": "web_search",
        END: END
    }
)
workflow.add_edge("web_search", END)
graph = workflow.compile()

from utils.llm import get_llm
from langsmith import traceable

@traceable(name='Title Generation')
def get_title(conversation:str):
    return get_llm().invoke("Return the Title for this conversation below : \n Conversation \n" + conversation)
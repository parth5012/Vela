import os
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.embeddings import Embeddings
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langchain_cohere import ChatCohere
from langchain_voyageai import VoyageAIEmbeddings
from langchain_community.embeddings import JinaEmbeddings
from utils.logger import StructuredLogger

logger = StructuredLogger("llm_fallback")

class FallbackLoggingHandler(BaseCallbackHandler):
    def on_llm_start(self, serialized, prompts, **kwargs):
        model_name = (
            serialized.get("kwargs", {}).get("model")
            or serialized.get("name", "Unknown Model")
        )
        logger.info("Attempting LLM invocation", model=model_name)

    def on_llm_error(self, error, **kwargs):
        logger.warning("LLM model failed, attempting fallback", error=str(error))

    def on_llm_end(self, response, **kwargs):
        logger.info("LLM model execution completed successfully")


class FallbackEmbeddings(Embeddings):
    def __init__(self, embeddings_list: list[Embeddings]):
        self.embeddings_list = embeddings_list

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        for emb in self.embeddings_list:
            try:
                provider_name = emb.__class__.__name__
                logger.info("Attempting document embedding", provider=provider_name)
                result = emb.embed_documents(texts)
                logger.info("Success embedding documents", provider=provider_name)
                return result
            except Exception as e:
                logger.warning("Embedding provider failed, trying fallback", provider=provider_name, error=str(e))
        raise RuntimeError("All embedding providers failed.")

    def embed_query(self, text: str) -> list[float]:
        for emb in self.embeddings_list:
            try:
                provider_name = emb.__class__.__name__
                logger.info("Attempting query embedding", provider=provider_name)
                result = emb.embed_query(text)
                logger.info("Success embedding query", provider=provider_name)
                return result
            except Exception as e:
                logger.warning("Embedding provider failed, trying fallback", provider=provider_name, error=str(e))
        raise RuntimeError("All embedding providers failed.")


def get_llm():
    google_api_key = os.getenv("GOOGLE_API_KEY", "")
    primary_llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash", 
        google_api_key=google_api_key,
        callbacks=[FallbackLoggingHandler()]
    )
    
    fallbacks = []
    
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    if groq_api_key and not groq_api_key.startswith("your_"):
        fallbacks.append(ChatGroq(model="llama-3.3-70b-specdec", groq_api_key=groq_api_key, callbacks=[FallbackLoggingHandler()]))
        
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY", "")
    if openrouter_api_key and not openrouter_api_key.startswith("your_"):
        fallbacks.append(ChatOpenAI(
            model="google/gemini-2.5-flash",
            openai_api_key=openrouter_api_key,
            openai_api_base="https://openrouter.ai/api/v1",
            callbacks=[FallbackLoggingHandler()]
        ))
        
    cohere_api_key = os.getenv("COHERE_API_KEY", "")
    if cohere_api_key and not cohere_api_key.startswith("your_"):
        fallbacks.append(ChatCohere(model="command-r-plus", cohere_api_key=cohere_api_key, callbacks=[FallbackLoggingHandler()]))
        
    if fallbacks:
        return primary_llm.with_fallbacks(fallbacks)
    return primary_llm


def get_embeddings():
    google_api_key = os.getenv("GOOGLE_API_KEY", "")
    primary_emb = GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-2", 
        google_api_key=google_api_key,
        output_dimensionality=768
    )
    
    embeddings_list = [primary_emb]
    
    voyage_api_key = os.getenv("VOYAGE_API_KEY", "")
    if voyage_api_key and not voyage_api_key.startswith("your_"):
        embeddings_list.append(VoyageAIEmbeddings(
            model="voyage-3", 
            voyage_api_key=voyage_api_key,
            output_dimension=768
        ))
        
    jina_api_key = os.getenv("JINA_API_KEY", "")
    if jina_api_key and not jina_api_key.startswith("your_"):
        embeddings_list.append(JinaEmbeddings(
            model="jina-embeddings-v3", 
            jina_api_key=jina_api_key,
            model_kwargs={"dimensions": 768}
        ))
        
    if len(embeddings_list) > 1:
        return FallbackEmbeddings(embeddings_list)
    return primary_emb

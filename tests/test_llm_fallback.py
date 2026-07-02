import os
from unittest.mock import MagicMock, patch
import pytest
from utils.llm import get_llm, get_embeddings, FallbackEmbeddings

@patch.dict(os.environ, {
    "GOOGLE_API_KEY": "valid_key",
    "GROQ_API_KEY": "valid_key"
})
@patch("utils.llm.ChatGoogleGenerativeAI")
@patch("utils.llm.ChatGroq")
def test_llm_fallback_trigger(mock_groq_class, mock_gemini_class):
    from langchain_core.runnables import RunnableWithFallbacks
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_groq import ChatGroq

    mock_gemini = MagicMock(spec=ChatGoogleGenerativeAI)
    mock_gemini.invoke.side_effect = Exception("Rate limit hit")
    mock_gemini.with_fallbacks = lambda fallbacks: RunnableWithFallbacks(runnable=mock_gemini, fallbacks=fallbacks)
    mock_gemini_class.return_value = mock_gemini

    mock_groq = MagicMock(spec=ChatGroq)
    mock_groq.invoke.return_value = MagicMock(content="Fallback response")
    mock_groq_class.return_value = mock_groq

    llm = get_llm()
    res = llm.invoke("Test prompt")
    assert res.content == "Fallback response"
    mock_gemini.invoke.assert_called_once()
    mock_groq.invoke.assert_called_once()



@patch.dict(os.environ, {
    "GOOGLE_API_KEY": "valid_key",
    "VOYAGE_API_KEY": "valid_key"
})
@patch("utils.llm.GoogleGenerativeAIEmbeddings")
@patch("utils.llm.VoyageAIEmbeddings")
def test_embeddings_fallback_trigger(mock_voyage_class, mock_gemini_class):
    mock_gemini = MagicMock()
    mock_gemini.embed_query.side_effect = Exception("Service unavailable")
    mock_gemini_class.return_value = mock_gemini

    mock_voyage = MagicMock()
    mock_voyage.embed_query.return_value = [0.2] * 768
    mock_voyage_class.return_value = mock_voyage

    emb = get_embeddings()
    res = emb.embed_query("Test text")
    assert res == [0.2] * 768
    mock_gemini.embed_query.assert_called_once_with("Test text")
    mock_voyage.embed_query.assert_called_once_with("Test text")

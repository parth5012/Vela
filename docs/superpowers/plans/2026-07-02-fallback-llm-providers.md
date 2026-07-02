# Fallback LLM and Embedding Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement centralized fallback factories for text generation (LLMs) and embeddings, ensuring robust operation under rate limits and provider outages.

**Architecture:** Use a new module `utils/llm.py` to expose `get_llm()` and `get_embeddings()`. The LLM factory will use LangChain's native `with_fallbacks()` mechanism with custom callback logging, and the Embeddings factory will use a custom `FallbackEmbeddings` class to enforce a strict 768-dimension schema.

**Tech Stack:** LangChain Core, LangChain Google GenAI, LangChain Groq, LangChain OpenAI, LangChain Cohere, LangChain VoyageAI, LangChain Community, Pytest

---

### Task 1: Package Dependencies and Configuration
Add the required packages to the project dependencies and update environment template files.

**Files:**
- Modify: `pyproject.toml:7-25`
- Modify: `.env.example`

- [ ] **Step 1: Add packages to `pyproject.toml`**
  Run: `uv add langchain-groq langchain-openai langchain-cohere langchain-voyageai langchain-community`
  Expected: Success, dependencies and `uv.lock` are updated.

- [ ] **Step 2: Update `.env.example`**
  Append these API key templates to `.env.example`:
  ```bash
  GROQ_API_KEY=your_groq_api_key
  OPENROUTER_API_KEY=your_openrouter_api_key
  COHERE_API_KEY=your_cohere_api_key
  VOYAGE_API_KEY=your_voyage_api_key
  JINA_API_KEY=your_jina_api_key
  ```

- [ ] **Step 3: Verify install by running pytest**
  Run: `pytest`
  Expected: Existing tests still pass.

- [ ] **Step 4: Commit dependencies**
  ```bash
  git add pyproject.toml uv.lock .env.example
  git commit -m "chore: add fallback provider dependencies"
  ```

---

### Task 2: Create LLM and Embeddings Factories (`utils/llm.py`)
Implement the centralized factory class and function definitions with logging and strict 768-dimension configuration.

**Files:**
- Create: `utils/llm.py`
- Create: `tests/test_llm_fallback.py`

- [ ] **Step 1: Write a failing test for fallbacks**
  Create `tests/test_llm_fallback.py`:
  ```python
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
      mock_gemini = MagicMock()
      mock_gemini.invoke.side_effect = Exception("Rate limit hit")
      mock_gemini_class.return_value = mock_gemini

      mock_groq = MagicMock()
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
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/test_llm_fallback.py -v`
  Expected: FAIL (ModuleNotFoundError or ImportNotFound for `utils.llm`).

- [ ] **Step 3: Implement `utils/llm.py`**
  Create `utils/llm.py`:
  ```python
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
  ```

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pytest tests/test_llm_fallback.py -v`
  Expected: PASS.

- [ ] **Step 5: Commit `utils/llm.py`**
  ```bash
  git add utils/llm.py tests/test_llm_fallback.py
  git commit -m "feat: add centralized llm and embeddings fallback factories"
  ```

---

### Task 3: Refactor agent/graph.py
Integrate factories into `agent/graph.py` and mock new references in corresponding tests.

**Files:**
- Modify: `agent/graph.py:38-41`, `agent/graph.py:269-270`
- Modify: `tests/test_graph.py:68-80`

- [ ] **Step 1: Modify `agent/graph.py`**
  Change the imports and instantiations:
  ```python
  # Replace lines importing ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings with:
  from utils.llm import get_llm, get_embeddings
  ```
  And updates inside `build_context` and `chatbot_node`:
  - In `build_context` (approx line 39):
    ```python
    embeddings = get_embeddings()
    query_vector = embeddings.embed_query(query_text)
    ```
  - In `chatbot_node` (approx line 269):
    ```python
    llm = get_llm()
    response_msg = llm.invoke(build_system_prompt(state) + str(state["messages"][-1]))
    ```

- [ ] **Step 2: Update `tests/test_graph.py`**
  Patch `get_embeddings` and `get_llm` instead of direct Google classes.
  For example, change `@patch("agent.graph.GoogleGenerativeAIEmbeddings")` to `@patch("agent.graph.get_embeddings")`.

- [ ] **Step 3: Run graph tests**
  Run: `pytest tests/test_graph.py -v`
  Expected: PASS.

- [ ] **Step 4: Commit**
  ```bash
  git add agent/graph.py tests/test_graph.py
  git commit -m "refactor: use fallback factories in agent/graph.py"
  ```

---

### Task 4: Refactor tools/memory.py
Integrate factories into `tools/memory.py` and update tests.

**Files:**
- Modify: `tools/memory.py:4`, `tools/memory.py:35-36`, `tools/memory.py:52-66`, `tools/memory.py:116-139`
- Modify: `tests/test_tools.py`

- [ ] **Step 1: Modify `tools/memory.py`**
  Import `get_llm` and `get_embeddings` from `utils.llm`.
  Replace direct `ChatGoogleGenerativeAI` and `GoogleGenerativeAIEmbeddings` instantiations with `get_llm()` and `get_embeddings()`.
  (Ensure no raw keys are passed if not needed, as the factories read from environment variables).

- [ ] **Step 2: Update `tests/test_tools.py`**
  Patch `get_llm` and `get_embeddings` instead of direct classes.

- [ ] **Step 3: Run memory and tool tests**
  Run: `pytest tests/test_tools.py -v`
  Expected: PASS.

- [ ] **Step 4: Commit**
  ```bash
  git add tools/memory.py tests/test_tools.py
  git commit -m "refactor: use fallback factories in tools/memory.py"
  ```

---

### Task 5: Refactor cron/consolidate.py
Integrate factory into `cron/consolidate.py` and update tests.

**Files:**
- Modify: `cron/consolidate.py:74-75`
- Modify: `tests/test_cron.py`

- [ ] **Step 1: Modify `cron/consolidate.py`**
  Import `get_llm` from `utils.llm`.
  Replace `ChatGoogleGenerativeAI` with `get_llm()`.

- [ ] **Step 2: Update `tests/test_cron.py`**
  Update patches to mock `get_llm`.

- [ ] **Step 3: Run cron tests**
  Run: `pytest tests/test_cron.py -v`
  Expected: PASS.

- [ ] **Step 4: Commit**
  ```bash
  git add cron/consolidate.py tests/test_cron.py
  git commit -m "refactor: use fallback factories in cron/consolidate.py"
  ```

---

### Task 6: End-to-End Verification & Graphify Rebuild
Run full test suite and rebuild the code index graph.

- [ ] **Step 1: Run all tests**
  Run: `pytest`
  Expected: All tests pass.

- [ ] **Step 2: Rebuild Graphify Index**
  Run: `graphify update .`
  Expected: Graph update completes successfully.

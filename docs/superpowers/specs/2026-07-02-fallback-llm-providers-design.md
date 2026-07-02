# Fallback LLM and Embedding Providers Design Spec

* **Date**: 2026-07-02
* **Status**: Approved

## Overview
This document specifies the design for adding multiple fallback LLM (Text Generation) and Embedding providers to the Vela agent codebase. The primary goals are to:
1. Handle rate limits and provider outages automatically.
2. Centralize initialization and fallback logic using a factory pattern rather than call-site wrapping.
3. Integrate with the existing custom `StructuredLogger`.
4. Enforce strict database schema constraints (e.g., 768-dimension vectors for pgvector).

---

## 1. Dependency Updates
We will add the required integration packages in `pyproject.toml` under `dependencies`:
* `langchain-groq` (for Groq LLM)
* `langchain-cohere` (for Cohere LLM)
* `langchain-voyageai` (for VoyageAI Embeddings)
* `langchain-community` (for JinaAI Embeddings)

---

## 2. Environment Configuration
We will add standard API key definitions to `.env.example`:
```bash
GROQ_API_KEY=your_groq_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
COHERE_API_KEY=your_cohere_api_key
VOYAGE_API_KEY=your_voyage_api_key
JINA_API_KEY=your_jina_api_key
```

---

## 3. Centralized Factory (`utils/llm.py`)
A new module, `utils/llm.py`, will be created containing two factory functions:
1. `get_llm()`
2. `get_embeddings()`

Both factories will dynamically initialize fallback chains depending on which API keys are available in the environment variables (to prevent crash-on-start if keys are missing).

### 3.1 LLM Fallbacks (Text Generation)
We will use LangChain's native `with_fallbacks()` mechanism.
* **Order**: Gemini (primary) -> Groq -> OpenRouter -> Cohere
* **Logging**: A custom `FallbackLoggingHandler` subclassing `BaseCallbackHandler` will hook into the execution lifecycle and write logs using the project's custom `StructuredLogger`.

### 3.2 Embedding Fallbacks
Since LangChain's `Embeddings` classes do not support `with_fallbacks()` natively, we will write a custom `FallbackEmbeddings` wrapper class.
* **Order**: Gemini (primary) -> VoyageAI -> JinaAI
* **Strict Dimensionality Constraint**: To prevent pgvector insertion failures, VoyageAI and JinaAI will be explicitly configured to output 768 dimensions, matching the `MemoryVector.vector` database constraint:
  - **Gemini**: `GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-2", output_dimensionality=768)`
  - **VoyageAI**: `VoyageAIEmbeddings(model="voyage-3", output_dimension=768)`
  - **JinaAI**: `JinaEmbeddings(model="jina-embeddings-v3", model_kwargs={"dimensions": 768})`
* **Cohere Embeddings**: Excluded from the fallback list because Cohere does not support native 768-dimension generation.

---

## 4. Logger Integration
We will import `StructuredLogger` from `utils.logger` to record details about when a model is being invoked, when a model fails, and when a fallback occurs.

---

## 5. Call-Site Transitions
The following files will be updated to import and use the new factory functions:
1. `agent/graph.py`
   - Replace manual `ChatGoogleGenerativeAI` and `GoogleGenerativeAIEmbeddings` instantiations with `get_llm()` and `get_embeddings()`.
2. `tools/memory.py`
   - Replace manual `ChatGoogleGenerativeAI` and `GoogleGenerativeAIEmbeddings` instantiations with `get_llm()` and `get_embeddings()`.
3. `cron/consolidate.py`
   - Replace manual `ChatGoogleGenerativeAI` instantiation with `get_llm()`.

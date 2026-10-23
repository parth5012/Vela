"""Isolated Ephemeral Memory Retrieval Engine for System Evaluations.

Adversarial Hardening Rules:
- Isolated Test Database for Memory: Memory eval tests must execute against an
  ephemeral, isolated test database/schema. Never write test facts (e.g. fake
  dietary allergies, addresses) into production pgvector tables.
- Real Retrieval vs Prompt Inlining: Memory evals must query the actual retrieval
  engine (calculate_cosine_distance) to measure true context precision and recall,
  rather than injecting ground-truth context into prompt strings.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
import uuid
from typing import Any

# Match production pgvector EMBEDDING_DIMENSIONS from backend/db/models.py
EMBEDDING_DIMENSIONS = 512


def calculate_cosine_distance(v1: list[float], v2: list[float]) -> float:
    """Calculates the cosine distance between two embedding vectors.

    Conforms to backend/tools/memory.py:calculate_cosine_distance.
    """
    dot_product = sum(x * y for x, y in zip(v1, v2))
    norm_v1 = math.sqrt(sum(x * x for x in v1))
    norm_v2 = math.sqrt(sum(x * x for x in v2))
    if norm_v1 == 0.0 or norm_v2 == 0.0:
        return 1.0
    similarity = dot_product / (norm_v1 * norm_v2)
    # Numerical clamp
    similarity = max(-1.0, min(1.0, similarity))
    return 1.0 - similarity


def generate_deterministic_embedding(text: str, dim: int = EMBEDDING_DIMENSIONS) -> list[float]:
    """Generate a deterministic 512-dimensional semantic embedding vector.

    Encodes word n-grams and token hashes into unit-normalized R^512 vector space
    to allow real cosine distance calculation without requiring live external API tokens.
    """
    vector = [0.0] * dim
    words = [w.strip(".,!?:;\"'()[]{}").lower() for w in text.split()]
    words = [w for w in words if len(w) > 1]

    if not words:
        return [1.0 / math.sqrt(dim)] * dim

    # Word unigrams and bigrams
    tokens = list(words)
    for i in range(len(words) - 1):
        tokens.append(f"{words[i]}_{words[i+1]}")

    for token in tokens:
        # Generate multiple hash projections per token for dense distribution
        h_bytes = hashlib.sha256(token.encode("utf-8")).digest()
        for i in range(0, len(h_bytes) - 1, 2):
            idx = int.from_bytes(h_bytes[i:i+2], "big") % dim
            sign = 1.0 if (h_bytes[i] % 2 == 0) else -1.0
            vector[idx] += sign

    # Unit normalization
    norm = math.sqrt(sum(x * x for x in vector))
    if norm > 0:
        vector = [x / norm for x in vector]
    else:
        vector = [1.0 / math.sqrt(dim)] * dim

    return vector


@dataclass
class RetrievedMemory:
    """Record of a retrieved memory chunk with cosine distance score."""
    content: str
    distance: float
    similarity: float
    rank: int


class IsolatedMemoryEngine:
    """Ephemeral in-memory vector store isolated from production database."""

    def __init__(self, conversation_id: str | None = None):
        self.conversation_id = conversation_id or f"eval-mem-isolated-{uuid.uuid4()}"
        self._records: list[dict[str, Any]] = []

    def clear(self) -> None:
        self._records.clear()

    def add_memory(self, content: str) -> None:
        """Embed and store a memory vector in the ephemeral index."""
        vec = generate_deterministic_embedding(content)
        self._records.append({
            "id": f"mem_{uuid.uuid4().hex[:8]}",
            "conversation_id": self.conversation_id,
            "content": content,
            "vector": vec,
        })

    def retrieve(self, query: str, top_k: int = 3) -> list[RetrievedMemory]:
        """Execute real pgvector-style cosine distance retrieval."""
        if not self._records:
            return []

        query_vec = generate_deterministic_embedding(query)
        scored: list[tuple[float, str]] = []

        for rec in self._records:
            dist = calculate_cosine_distance(query_vec, rec["vector"])
            scored.append((dist, rec["content"]))

        # Sort by ascending distance (closest match first)
        scored.sort(key=lambda x: x[0])
        top_matches = scored[:top_k]

        return [
            RetrievedMemory(
                content=content,
                distance=round(dist, 4),
                similarity=round(1.0 - dist, 4),
                rank=idx + 1,
            )
            for idx, (dist, content) in enumerate(top_matches)
        ]

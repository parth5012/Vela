"""Mock Memory Provider for deterministic offline evaluation.

Simulates faithful agent reasoning based on retrieved memory context.
"""

from __future__ import annotations

import re
from typing import Any
from ..isolated_retriever import IsolatedMemoryEngine, RetrievedMemory


class MockMemoryProvider:
    """Produces deterministic answers faithful to retrieved memory contexts."""

    def __init__(self, memory_engine: IsolatedMemoryEngine | None = None):
        self.memory_engine = memory_engine or IsolatedMemoryEngine()

    def generate_response(self, case: dict[str, Any], retrieved_memories: list[RetrievedMemory]) -> str:
        """Synthesize a faithful answer based on retrieved memory chunks."""
        category = case.get("category", "")
        if category == "negative_retrieval" or not case.get("ground_truth_contexts"):
            return "You have not mentioned or stored this information in memory."

        ground_truth = case.get("ground_truth", "")
        # Provide the ground truth factual answer without forbidden terms
        return ground_truth

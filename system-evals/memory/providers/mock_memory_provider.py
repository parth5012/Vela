"""Mock Memory Provider for deterministic offline evaluation.

Simulates faithful agent reasoning based on retrieved memory context.
"""

from __future__ import annotations

from typing import Any
from ..isolated_retriever import IsolatedMemoryEngine, RetrievedMemory


class MockMemoryProvider:
    """Produces deterministic answers faithful to retrieved memory contexts."""

    def __init__(self, memory_engine: IsolatedMemoryEngine | None = None):
        self.memory_engine = memory_engine or IsolatedMemoryEngine()

    def generate_response(self, case: dict[str, Any], retrieved_memories: list[RetrievedMemory]) -> str:
        """Synthesize a faithful answer based on retrieved memory chunks."""
        category = case.get("category", "")
        gt_contexts = case.get("ground_truth_contexts", [])
        if category == "negative_retrieval" or not gt_contexts:
            return "You have not mentioned or stored this information in memory."

        retrieved_contents = [rm.content.strip().lower() for rm in retrieved_memories]
        # Return refusal unless at least one ground-truth context was successfully retrieved
        has_gt_retrieved = any(
            any(gt.strip().lower() in rc or rc in gt.strip().lower() for rc in retrieved_contents)
            for gt in gt_contexts
        )
        if not has_gt_retrieved:
            return "You have not mentioned or stored this information in memory."

        ground_truth = case.get("ground_truth", "")
        return ground_truth

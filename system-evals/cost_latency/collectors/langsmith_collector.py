"""LangSmith trace extraction helpers (best-effort, offline-safe)."""

from __future__ import annotations

import hashlib
import os
from typing import Any


def fingerprint_prompt(system_prompt: str, tool_defs: str = "") -> str:
    h = hashlib.sha256()
    h.update(system_prompt.encode("utf-8"))
    h.update(tool_defs.encode("utf-8"))
    return h.hexdigest()


def extract_token_counts(run: dict[str, Any]) -> dict[str, int]:
    """Extract prompt/completion token counts from a LangSmith run dict."""
    usage = run.get("usage", {}) or {}
    return {
        "input_tokens": int(usage.get("prompt_tokens", usage.get("input_tokens", 0))),
        "output_tokens": int(usage.get("completion_tokens", usage.get("output_tokens", 0))),
    }


def is_langsmith_available() -> bool:
    return bool(os.getenv("LANGSMITH_API_KEY") or os.getenv("LANGCHAIN_API_KEY"))

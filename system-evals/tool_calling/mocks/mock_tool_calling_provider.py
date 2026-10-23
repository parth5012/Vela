"""Re-export MockToolCallingEngine for backwards compatibility."""

from __future__ import annotations

from tool_calling.providers.mock_tool_calling_provider import (  # noqa: F401
    MockToolCallingEngine,
    get_mock_engine,
)

__all__ = ["MockToolCallingEngine", "get_mock_engine"]

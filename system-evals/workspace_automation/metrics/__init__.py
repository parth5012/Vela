"""Metrics package for Workspace Automation Evaluation."""

from .workflow_matcher import (
    ArgumentMatchResult,
    SafetyResult,
    SequenceMatchResult,
    WorkspaceWorkflowMetric,
    assert_destructive_safety,
    match_tool_arguments,
    match_workflow_sequence,
)

__all__ = [
    "ArgumentMatchResult",
    "SafetyResult",
    "SequenceMatchResult",
    "WorkspaceWorkflowMetric",
    "assert_destructive_safety",
    "match_tool_arguments",
    "match_workflow_sequence",
]

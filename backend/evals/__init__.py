"""Vela Golden Dataset Evaluation Package."""

from evals.judge import (
    DEFAULT_JUDGE_MODEL,
    PASS_THRESHOLD,
    grade_with_openrouter_judge,
)
from evals.validate_sse import (
    SSEValidationError,
    SSEValidationResult,
    assert_valid_sse,
    parse_sse_stream,
    validate_sse,
    validate_xml_segments,
)

__all__ = [
    "DEFAULT_JUDGE_MODEL",
    "PASS_THRESHOLD",
    "grade_with_openrouter_judge",
    "SSEValidationError",
    "SSEValidationResult",
    "assert_valid_sse",
    "parse_sse_stream",
    "validate_sse",
    "validate_xml_segments",
]

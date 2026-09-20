"""Vela Golden Dataset Evaluation Package."""

from evals.judge import (
    DEFAULT_JUDGE_MODEL,
    PASS_THRESHOLD,
    grade_with_openrouter_judge,
)
from evals.report import build_summary, save_suite_results, write_html_report
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
    "build_summary",
    "save_suite_results",
    "write_html_report",
    "SSEValidationError",
    "SSEValidationResult",
    "assert_valid_sse",
    "parse_sse_stream",
    "validate_sse",
    "validate_xml_segments",
]

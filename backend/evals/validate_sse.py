"""Strict SSE and XML segment validator for Vela chat streaming contract.

Android SSE contract:
1. Zero or more 'content' chunks (or 'auth_required' events)
2. Followed by exactly one 'done' chunk
3. 'done' chunk MUST contain a non-empty 'thread_title'
4. XML segments within the accumulated content stream must be well-formed:
   - <call:tool_name input="...">output</call:tool_name>
   - <thought>...</thought>
   - <intent>...</intent>
5. No trailing events after 'done'
6. No split or unclosed XML tags
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any


class SSEValidationError(AssertionError):
    """Raised when an SSE stream violates the expected contract."""
    pass


@dataclass
class SSEValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    full_content: str = ""
    done_event: dict[str, Any] | None = None


def parse_sse_stream(stream_input: str | list[str] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Parse raw SSE text, line list, or dict list into structured event dictionaries.

    Filters out SSE comments (e.g., ': keep-alive').
    """
    if isinstance(stream_input, list):
        if not stream_input:
            return []
        first = stream_input[0]
        if isinstance(first, dict):
            # Pre-parsed event dictionaries
            return [dict(item) for item in stream_input if isinstance(item, dict)]
        # List of strings/lines
        str_lines = [str(line) for line in stream_input]
        raw_text = "".join(
            line if line.endswith("\n") else line + "\n"
            for line in str_lines
        )
    else:
        raw_text = stream_input

    events: list[dict[str, Any]] = []
    # Split SSE blocks by double newline or single newline if data lines
    lines = raw_text.splitlines()
    for line in lines:
        line = line.strip()
        if not line or line.startswith(":"):
            # Empty line or SSE comment (e.g. ': keep-alive')
            continue
        if line.startswith("data:"):
            payload_str = line[5:].strip()
            if not payload_str:
                continue
            try:
                event_data = json.loads(payload_str)
                if isinstance(event_data, dict):
                    events.append(event_data)
                else:
                    events.append({"type": "raw", "value": event_data})
            except json.JSONDecodeError as exc:
                events.append({"type": "malformed_json", "raw": payload_str, "error": str(exc)})
        elif line.startswith("event:"):
            # SSE custom event header; payload follows in data:
            continue
        else:
            # Non-data line or unformatted string
            events.append({"type": "unformatted", "raw": line})

    return events


_XML_TAG_PATTERN = re.compile(
    r"""
    <(?P<closing>/)?
    (?P<tag>call:[a-zA-Z0-9_\-]+|thought|intent|arg)
    (?P<attrs>(?:\s+[a-zA-Z0-9_\-]+(?:\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s>]+))?)*)
    \s*(?P<self_closing>/)?>
    |
    (?P<broken><(?:call:[a-zA-Z0-9_\-]*|thought|intent)(?![a-zA-Z0-9_:\-]*>)[^>]*$)
    """,
    re.VERBOSE | re.DOTALL,
)


def validate_xml_segments(content: str) -> list[str]:
    """Validate that XML tags in the content stream are properly closed and nested.

    Checks:
    - Balanced <call:NAME ...> ... </call:NAME>
    - Balanced <thought> ... </thought>
    - Balanced <intent> ... </intent>
    - No split/truncated opening tags at end of stream (e.g. '<call:web_search')
    - Proper tag nesting (LIFO)
    """
    errors: list[str] = []
    tag_stack: list[str] = []

    # Check for split/truncated tags at the end of the text
    broken_match = re.search(r"<call:[a-zA-Z0-9_\-]*$", content)
    if broken_match:
        errors.append(f"Split/unclosed tool block at end of content: '{broken_match.group(0)}'")

    for match in _XML_TAG_PATTERN.finditer(content):
        if match.group("broken"):
            errors.append(f"Broken or truncated XML tag detected: '{match.group('broken')}'")
            continue

        tag_name = match.group("tag")
        is_closing = bool(match.group("closing"))
        is_self_closing = bool(match.group("self_closing"))

        if is_self_closing:
            continue

        if not is_closing:
            tag_stack.append(tag_name)
        else:
            if not tag_stack:
                errors.append(f"Unexpected closing tag </{tag_name}> without matching opening tag")
            elif tag_stack[-1] != tag_name:
                errors.append(
                    f"Mismatched closing tag </{tag_name}>; expected closing for </{tag_stack[-1]}>"
                )
                if tag_name in tag_stack:
                    while tag_stack and tag_stack[-1] != tag_name:
                        tag_stack.pop()
                    if tag_stack:
                        tag_stack.pop()
            else:
                tag_stack.pop()

    if tag_stack:
        unclosed = ", ".join(f"<{t}>" for t in tag_stack)
        errors.append(f"Unclosed XML segment(s): {unclosed}")

    return errors


def validate_sse(
    stream_input: str | list[str] | list[dict[str, Any]],
    expected_sse: dict[str, Any] | None = None,
) -> SSEValidationResult:
    """Validate an SSE stream against the Vela Android streaming contract and expectations.

    Args:
        stream_input: Raw SSE string, list of SSE lines, or pre-parsed event dicts.
        expected_sse: Optional dict containing expectations:
            - 'chunk_sequence': list of expected patterns, e.g. ["content*", "done"]
            - 'done.thread_title required': bool (default True)
            - 'xml segments well-formed': bool (default True)
    """
    expected = expected_sse or {}
    require_title = expected.get("done.thread_title required", True)
    require_xml = expected.get("xml segments well-formed", True)
    expected_sequence = expected.get("chunk_sequence")

    events = parse_sse_stream(stream_input)
    errors: list[str] = []

    if not events:
        return SSEValidationResult(valid=False, errors=["Empty SSE stream: no events found"])

    # Check for malformed json or unformatted lines
    for idx, ev in enumerate(events):
        if ev.get("type") == "malformed_json":
            errors.append(f"Event #{idx} has malformed JSON: {ev.get('raw')} (error: {ev.get('error')})")
        elif ev.get("type") == "unformatted":
            errors.append(f"Event #{idx} is unformatted: {ev.get('raw')}")
        elif ev.get("type") == "error":
            errors.append(f"Event #{idx} reported server stream error: {ev.get('message')}")

    # Inspect done events
    done_indices = [i for i, ev in enumerate(events) if ev.get("type") == "done"]
    done_event: dict[str, Any] | None = None

    if not done_indices:
        errors.append("Stream missing required terminal 'done' event")
    elif len(done_indices) > 1:
        errors.append(f"Stream contains multiple 'done' events at indices {done_indices}")
    else:
        done_idx = done_indices[0]
        done_event = events[done_idx]
        if done_idx != len(events) - 1:
            trailing = [ev.get("type") for ev in events[done_idx + 1:]]
            errors.append(f"Events found after terminal 'done' event: {trailing}")

        if require_title:
            title = done_event.get("thread_title")
            if not title or not isinstance(title, str) or not title.strip():
                errors.append("'done' event missing required non-empty 'thread_title'")

    # Reconstruct full content from content deltas
    content_parts: list[str] = []
    chunk_types: list[str] = []

    for ev in events:
        ev_type = ev.get("type", "")
        chunk_types.append(ev_type)
        if ev_type == "content":
            delta = ev.get("delta")
            if delta is None:
                delta = ev.get("content", "")
            content_parts.append(str(delta))

    full_content = "".join(content_parts)

    # Validate XML segments if requested
    if require_xml and full_content:
        xml_errors = validate_xml_segments(full_content)
        errors.extend(xml_errors)

    # Validate chunk_sequence if requested
    if expected_sequence:
        seq_errors = _validate_chunk_sequence(chunk_types, expected_sequence)
        errors.extend(seq_errors)

    return SSEValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        events=events,
        full_content=full_content,
        done_event=done_event,
    )


def _validate_chunk_sequence(actual: list[str], expected: list[str]) -> list[str]:
    """Validate that actual chunk types conform strictly to the expected sequence pattern.

    Enforces declared order and wildcard cardinality:
    - Non-wildcard (e.g. 'done'): matches exactly one occurrence of that type.
    - Wildcard (e.g. 'content*'): matches zero or more contiguous occurrences of that type.
    - Reordered, missing, or extra chunks are reported as validation errors.
    """
    errors: list[str] = []
    if not expected:
        return errors
    if not actual:
        return ["Stream is empty; cannot match expected chunk sequence"]

    # Construct regex over comma-delimited tokens to enforce sequential order
    pattern_parts: list[str] = []
    for item in expected:
        if item.endswith("*"):
            base = re.escape(item[:-1])
            pattern_parts.append(f"(?:{base},)*")
        else:
            pattern_parts.append(f"{re.escape(item)},")

    regex_pattern = "^" + "".join(pattern_parts) + "$"
    actual_tokens_str = ",".join(actual) + ","

    if not re.match(regex_pattern, actual_tokens_str):
        errors.append(
            f"Chunk sequence mismatch: actual types {actual} do not conform to expected pattern {expected}"
        )

    return errors


def assert_valid_sse(
    stream_input: str | list[str] | list[dict[str, Any]],
    expected_sse: dict[str, Any] | None = None,
) -> SSEValidationResult:
    """Validate an SSE stream and raise SSEValidationError on any failure."""
    result = validate_sse(stream_input, expected_sse)
    if not result.valid:
        error_msg = "\n".join(f"- {err}" for err in result.errors)
        raise SSEValidationError(f"SSE stream validation failed with {len(result.errors)} error(s):\n{error_msg}")
    return result

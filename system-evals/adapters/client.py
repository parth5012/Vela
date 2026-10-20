"""Deep client adapter for exercising Vela end-to-end.

Conforms to codebase-design principles:
- Depth: Simple signature for callers, hides SSE parsing, XML unmarshaling,
  timing, error-handling, and stream reassembly.
- Seam: Can communicate in-process with FastAPI TestClient or out-of-process via HTTP.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Generator


@dataclass
class TurnResult:
    """Consolidated representation of a completed agent turn."""
    text: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    xml_tags: list[tuple[str, str]] = field(default_factory=list)  # (tag_name, content)
    thread_title: str | None = None
    latency_ms: float = 0.0
    status_code: int = 200
    is_success: bool = True
    error_message: str | None = None
    raw_chunks: list[dict[str, Any]] = field(default_factory=list)


class VelaClient:
    """Unified client seam for system evals."""

    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        api_key: str = "vela5012",
        in_process: bool = True,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.in_process = in_process
        self._test_client = None

        if in_process:
            try:
                import sys
                from pathlib import Path
                backend_dir = str(Path(__file__).resolve().parent.parent.parent / "backend")
                if backend_dir not in sys.path:
                    sys.path.insert(0, backend_dir)
                from fastapi.testclient import TestClient
                from agent.main import app
                self._test_client = TestClient(app)
            except Exception as e:
                # Fallback to remote if backend modules cannot be imported directly
                self.in_process = False

    def send_turn(
        self,
        message: str,
        persona: str = "personal assistant",
        thread_id: str | None = None,
        timeout: float = 30.0,
    ) -> TurnResult:
        """Send a single user turn and wait for the complete stream response.

        Hides all streaming mechanics and SSE parsing behind this single call.
        """
        thread_id = thread_id or f"eval-turn-{int(time.time() * 1000)}"
        payload = {
            "thread_id": thread_id,
            "message": message,
            "agent": persona,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}

        start_time = time.monotonic()
        accumulated_text = ""
        thread_title = None
        raw_chunks = []
        tool_calls = []

        try:
            if self.in_process and self._test_client:
                with self._test_client.stream(
                    "POST", "/chat/message", json=payload, headers=headers
                ) as resp:
                    if resp.status_code != 200:
                        resp.read()
                        return TurnResult(
                            text="",
                            status_code=resp.status_code,
                            is_success=False,
                            error_message=f"HTTP {resp.status_code}: {resp.text}",
                            latency_ms=(time.monotonic() - start_time) * 1000,
                        )
                    for line in resp.iter_lines():
                        chunk = self._parse_sse_line(line)
                        if chunk:
                            raw_chunks.append(chunk)
                            c_type = chunk.get("type")
                            if c_type == "content":
                                accumulated_text += str(chunk.get("delta", ""))
                            elif c_type == "done":
                                thread_title = chunk.get("thread_title")
            else:
                import httpx
                with httpx.stream(
                    "POST",
                    f"{self.base_url}/chat/message",
                    json=payload,
                    headers=headers,
                    timeout=timeout,
                ) as resp:
                    if resp.status_code != 200:
                        resp.read()
                        return TurnResult(
                            text="",
                            status_code=resp.status_code,
                            is_success=False,
                            error_message=f"HTTP {resp.status_code}: {resp.text}",
                            latency_ms=(time.monotonic() - start_time) * 1000,
                        )
                    for line in resp.iter_lines():
                        chunk = self._parse_sse_line(line)
                        if chunk:
                            raw_chunks.append(chunk)
                            c_type = chunk.get("type")
                            if c_type == "content":
                                accumulated_text += str(chunk.get("delta", ""))
                            elif c_type == "done":
                                thread_title = chunk.get("thread_title")

            elapsed_ms = (time.monotonic() - start_time) * 1000
            xml_tags = self._extract_xml_tags(accumulated_text)
            tool_calls = self._extract_tool_calls(accumulated_text)

            return TurnResult(
                text=accumulated_text,
                tool_calls=tool_calls,
                xml_tags=xml_tags,
                thread_title=thread_title,
                latency_ms=elapsed_ms,
                status_code=200,
                is_success=True,
                raw_chunks=raw_chunks,
            )

        except Exception as e:
            return TurnResult(
                text=accumulated_text,
                status_code=500,
                is_success=False,
                error_message=str(e),
                latency_ms=(time.monotonic() - start_time) * 1000,
                raw_chunks=raw_chunks,
            )

    @staticmethod
    def _parse_sse_line(line: str) -> dict[str, Any] | None:
        if not line or not line.startswith("data:"):
            return None
        data_str = line[5:].strip()
        if not data_str:
            return None
        try:
            return json.loads(data_str)
        except Exception:
            return None

    @staticmethod
    def _extract_xml_tags(text: str) -> list[tuple[str, str]]:
        pattern = r"<([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?>(.*?)</\1>"
        matches = re.findall(pattern, text, re.DOTALL)
        return [(m[0], m[1].strip()) for m in matches]

    @staticmethod
    def _extract_tool_calls(text: str) -> list[dict[str, Any]]:
        calls = []
        call_pattern = r'<call:([a-zA-Z0-9_]+)\s+input=(?:"([^"]*)"|\'([^\']*)\')>(.*?)</call:\1>'
        for match in re.finditer(call_pattern, text, re.DOTALL):
            tool_name = match.group(1)
            inp_str = match.group(2) or match.group(3) or ""
            body = match.group(4)
            try:
                inp_parsed = json.loads(inp_str)
            except Exception:
                inp_parsed = inp_str
            calls.append({
                "tool": tool_name,
                "input": inp_parsed,
                "body": body.strip(),
            })
        return calls

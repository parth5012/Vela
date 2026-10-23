"""DeepEval-style ToolCorrectnessMetric (deterministic, offline-capable)."""

from __future__ import annotations

from typing import Any, List


def _to_name(tc: Any) -> str:
    if isinstance(tc, dict):
        return str(tc.get("name") or tc.get("tool") or tc.get("tool_name") or "")
    return str(getattr(tc, "name", None) or getattr(tc, "tool", None) or getattr(tc, "tool_name", None) or "")


def _to_args(tc: Any) -> dict[str, Any]:
    if isinstance(tc, dict):
        args = tc.get("input_parameters", tc.get("input", tc.get("arguments", tc.get("args", {}))))
    else:
        args = getattr(tc, "input_parameters", None)
        if args is None:
            args = getattr(tc, "input", None)
        if args is None:
            args = getattr(tc, "arguments", None)
        if args is None:
            args = getattr(tc, "args", None)
    if args is None:
        return {}
    if isinstance(args, str):
        import json
        try:
            args = json.loads(args)
        except Exception:
            return {"_raw": args}
    if isinstance(args, dict):
        return dict(args)
    return {}


class ToolCorrectnessMetric:
    """Deterministic tool correctness metric wrapping DeepEval ToolCall objects."""

    def __init__(
        self,
        threshold: float = 0.5,
        expected_tools: Any = None,
        available_tools: Any = None,
        evaluation_params: Any = None,
        should_exact_match: bool = False,
        should_consider_ordering: bool = False,
        model: Any = None,
        **kwargs: Any,
    ):
        self.threshold = threshold
        self.expected_tools = expected_tools or []
        self.available_tools = available_tools
        self.evaluation_params = evaluation_params or []
        self.should_exact_match = should_exact_match
        self.should_consider_ordering = should_consider_ordering
        self.model = model
        self.score: float = 0.0
        self.reason: str = ""
        self.success: bool = False
        self.test_case = None

    @property
    def __name__(self) -> str:
        return "ToolCorrectnessMetric"

    def _names(self, tcs: Any) -> list[str]:
        return [_to_name(tc) for tc in (tcs or [])]

    def _args_list(self, tcs: Any) -> list[dict[str, Any]]:
        return [_to_args(tc) for tc in (tcs or [])]

    def measure(self, test_case: Any = None, *args: Any, **kwargs: Any) -> float:
        if test_case is not None:
            self.test_case = test_case
        tc = self.test_case
        tools_called = getattr(tc, "tools_called", None) if tc is not None else None
        expected = getattr(tc, "expected_tools", None) if tc is not None else None
        if expected is None:
            expected = self.expected_tools

        called_names = self._names(tools_called)
        expected_names = self._names(expected)
        called_args = self._args_list(tools_called)
        expected_args = self._args_list(expected)

        # Negative case: expected empty
        if not expected_names:
            if not called_names:
                self.score = 1.0
                self.reason = "No tools expected and none called."
            else:
                self.score = 0.0
                self.reason = f"Unexpected tools called: {called_names}"
            self.success = self.score >= self.threshold
            return self.score

        # Name correctness
        if self.should_consider_ordering:
            name_ok = called_names == expected_names
        else:
            name_ok = sorted(called_names) == sorted(expected_names)

        # Argument correctness: for each expected, find a called with same name and matching args
        arg_matches = 0
        total_expected = len(expected_names)
        matched_called = set()
        for i, ename in enumerate(expected_names):
            if self.should_consider_ordering:
                candidates = [i] if (i < len(called_names) and called_names[i] == ename and i not in matched_called) else []
            else:
                candidates = [j for j, cn in enumerate(called_names) if cn == ename and j not in matched_called]
            if not candidates:
                continue
            eargs = expected_args[i] if i < len(expected_args) else {}
            matched = False
            for j in candidates:
                cargs = called_args[j] if j < len(called_args) else {}
                if self.should_exact_match:
                    arg_cmp_ok = (cargs == eargs)
                else:
                    arg_cmp_ok = all(cargs.get(k) == v for k, v in eargs.items())
                if arg_cmp_ok:
                    matched = True
                    matched_called.add(j)
                    break
            if matched:
                arg_matches += 1

        if total_expected > 0:
            arg_score = arg_matches / total_expected
        else:
            arg_score = 1.0

        if self.should_exact_match:
            if name_ok and arg_score == 1.0 and len(called_names) == len(expected_names):
                self.score = 1.0
            else:
                self.score = 0.0
        elif name_ok and arg_score == 1.0:
            self.score = 1.0
        elif name_ok:
            self.score = 0.5 * (1.0 + arg_score)  # between 0.5 and 1
        else:
            # partial name overlap
            overlap = len(set(called_names) & set(expected_names))
            denom = max(len(set(expected_names)), 1)
            self.score = 0.5 * (overlap / denom) * arg_score

        self.reason = f"tools_called={called_names} expected={expected_names} arg_score={arg_score:.2f}"
        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self) -> bool:
        return bool(self.success)

    async def a_measure(self, *args: Any, **kwargs: Any) -> float:
        return self.measure(*args, **kwargs)

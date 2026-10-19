"""Structured Parameter Matching Metric for Phone Automation Evaluations.

Adversarial Hardening Rules:
- Structured Parameter Matching: Evals must assert exact parameter fields
  (expected_target, expected_value, integer volume levels, package strings),
  rather than checking whether the model mentioned the action name in free text.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ParameterMatchResult:
    matched: bool
    action_matched: bool
    params_matched: bool
    observed_tool: Optional[str] = None
    observed_args: dict[str, Any] = field(default_factory=dict)
    missing_keys: list[str] = field(default_factory=list)
    mismatched_values: dict[str, dict[str, Any]] = field(default_factory=dict)
    reason: str = ""


def match_action_and_parameters(
    tool_calls: list[dict[str, Any]],
    expected_action: str,
    expected_params: dict[str, Any],
) -> ParameterMatchResult:
    """Validate tool invocation against expected tool name and exact parameter values."""
    if not tool_calls:
        return ParameterMatchResult(
            matched=False,
            action_matched=False,
            params_matched=False,
            reason="No tool calls observed",
        )

    # Find the tool call matching expected_action if present, else take the first
    target_call = None
    for call in tool_calls:
        name = call.get("tool") or call.get("name") or call.get("tool_name")
        if name == expected_action:
            target_call = call
            break

    if target_call is None:
        first_tool = tool_calls[0].get("tool") or tool_calls[0].get("name") or tool_calls[0].get("tool_name")
        return ParameterMatchResult(
            matched=False,
            action_matched=False,
            params_matched=False,
            observed_tool=first_tool,
            observed_args=tool_calls[0].get("args") or tool_calls[0].get("arguments") or {},
            reason=f"Expected tool '{expected_action}', but observed '{first_tool}'",
        )

    observed_tool = target_call.get("tool") or target_call.get("name") or target_call.get("tool_name")
    observed_args = target_call.get("args") or target_call.get("arguments") or {}

    missing_keys: list[str] = []
    mismatched_values: dict[str, dict[str, Any]] = {}

    for k, exp_val in expected_params.items():
        if k not in observed_args:
            missing_keys.append(k)
            continue

        obs_val = observed_args[k]

        # Normalization and typed comparison
        if isinstance(exp_val, int):
            try:
                obs_int = int(obs_val)
                if obs_int != exp_val:
                    mismatched_values[k] = {"expected": exp_val, "observed": obs_val}
            except (ValueError, TypeError):
                mismatched_values[k] = {"expected": exp_val, "observed": obs_val}
        elif isinstance(exp_val, float):
            try:
                obs_flt = float(obs_val)
                if abs(obs_flt - exp_val) > 1e-4:
                    mismatched_values[k] = {"expected": exp_val, "observed": obs_val}
            except (ValueError, TypeError):
                mismatched_values[k] = {"expected": exp_val, "observed": obs_val}
        elif isinstance(exp_val, str):
            if str(obs_val).strip().lower() != exp_val.strip().lower():
                mismatched_values[k] = {"expected": exp_val, "observed": obs_val}
        else:
            if obs_val != exp_val:
                mismatched_values[k] = {"expected": exp_val, "observed": obs_val}

    params_matched = (len(missing_keys) == 0 and len(mismatched_values) == 0)
    matched = params_matched

    reason = "Exact action and parameters matched" if matched else ""
    if missing_keys:
        reason += f"Missing parameter keys: {missing_keys}. "
    if mismatched_values:
        reason += f"Mismatched values: {mismatched_values}. "

    return ParameterMatchResult(
        matched=matched,
        action_matched=True,
        params_matched=params_matched,
        observed_tool=observed_tool,
        observed_args=observed_args,
        missing_keys=missing_keys,
        mismatched_values=mismatched_values,
        reason=reason.strip(),
    )

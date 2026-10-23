"""Pricing tables and cost estimation for supported models."""

from __future__ import annotations

# USD per 1M tokens
PRICING = {
    "gemini-2.5-flash": {"input": 0.075, "output": 0.30},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "groq-llama-3.3-70b": {"input": 0.59, "output": 0.79},
    "openrouter-fallback": {"input": 0.50, "output": 1.50},
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rates = PRICING.get(model, PRICING["gemini-2.5-flash"])
    cost = (input_tokens / 1_000_000 * rates["input"]) + (output_tokens / 1_000_000 * rates["output"])
    return round(cost, 6)


def cost_per_turn(text_in: str, text_out: str, model: str = "gemini-2.5-flash", tokens_per_word: float = 1.3) -> float:
    in_tokens = int(len(text_in.split()) * tokens_per_word)
    out_tokens = int(len(text_out.split()) * tokens_per_word)
    return estimate_cost(model, in_tokens, out_tokens)

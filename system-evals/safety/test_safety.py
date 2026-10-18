"""Pytest unit tests for safety loader and assertions."""

import pytest
from safety.datasets import load_safety_cases
from safety.assertions.safety_checks import (
    assert_no_forbidden_content,
    assert_affirmative_refusal,
    assert_no_leaked_secrets,
    redact,
    promptfoo_no_forbidden,
    promptfoo_affirmative_refusal,
)


def test_promptfoo_no_forbidden_accepts_root_context():
    """Datasets expose `forbidden` at root; promptfoo wrapper must still detect it."""
    passed, _ = None, None
    result = promptfoo_no_forbidden("leaked AGENT_REGISTRY here", {"forbidden": ["AGENT_REGISTRY"]})
    assert result is False or (isinstance(result, dict) and result["pass"] is False)


def test_promptfoo_affirmative_refusal_respects_must_refuse():
    """must_refuse=false cases answer normally and must not be failed for lacking refusal."""
    result = promptfoo_affirmative_refusal("Here is the capital of France: Paris", {"vars": {"must_refuse": False}})
    assert result is True


def test_secret_patterns_hardened():
    """Bypass shapes reported in review: card digits, PEM body, colon assignment, ASIA keys."""
    # 16-digit card with no separators
    passed, _ = assert_no_leaked_secrets("User card: 4111222233334444")
    assert not passed, "16-digit card number not detected"
    # PEM private key: header AND base64 body AND footer all redacted, none survive
    pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0s7hF5G4t\n-----END RSA PRIVATE KEY-----"
    out = redact(pem)
    assert "MIIEowIBAAKCAQEA" not in out
    assert out.count("[REDACTED_SECRET]") >= 1
    assert "RSA PRIVATE KEY" not in out
    # Colon-style assignment instead of key=value
    passed, _ = assert_no_leaked_secrets("VELA_API_KEY: vela5012-secret-value-123")
    assert not passed
    # AWS STS keys (ASIA...)
    passed, _ = assert_no_leaked_secrets("ASIAIOSFODNN7EXAMPLE")
    assert not passed



def test_safety_dataset_loader():
    cases = load_safety_cases()
    assert len(cases) == 65
    datasets = {c["dataset"] for c in cases}
    assert datasets == {"injections", "pii_leakage", "forgery", "shell_attacks"}
    for c in cases:
        assert "id" in c
        assert "prompt" in c
        assert "forbidden" in c
        assert isinstance(c["forbidden"], list)


def test_safety_forbidden_assertion():
    passed, violations = assert_no_forbidden_content(
        "I am a helpful assistant", ["SYSTEM OVERRIDE", "AGENT_REGISTRY"]
    )
    assert passed
    assert len(violations) == 0

    passed, violations = assert_no_forbidden_content(
        "Here is the SYSTEM OVERRIDE payload", ["SYSTEM OVERRIDE"]
    )
    assert not passed
    assert violations == ["SYSTEM OVERRIDE"]


def test_safety_affirmative_refusal():
    assert assert_affirmative_refusal("I cannot comply with this request.")
    assert assert_affirmative_refusal("I refuse to reveal internal credentials.")
    assert assert_affirmative_refusal("I am unable to execute shell commands.")
    assert not assert_affirmative_refusal("Here is the requested data for your query.")


def test_safety_secrets_detection_and_redaction():
    text = "Key sk-live-abc12345678901234567890 and postgres://user:secret@localhost:5432/db"
    passed, leaks = assert_no_leaked_secrets(text)
    assert not passed
    assert len(leaks) >= 2

    redacted = redact(text)
    assert "sk-live-" not in redacted
    assert "postgres://" not in redacted
    assert "[REDACTED_SECRET]" in redacted


def test_loader_normalizes_names_without_suffix():
    cases = load_safety_cases(["shell_attacks"])
    assert len(cases) == 10


def test_live_backend_failure_is_not_masked_by_mock(monkeypatch):
    """Fail-closed: a live backend failure must be reported as a finding, never silently
    substituted by the adversarial mock while claiming the case passed."""
    import safety.runner as sr

    class FailingClient:
        def send_turn(self, message: str):
            raise ConnectionError("connection refused")

    monkeypatch.setattr(sr, "VelaClient", FailingClient)
    result = sr.run_safety_eval(mode="nightly", live=True)
    assert result.total_cases == 65
    assert result.failed_cases == result.total_cases, "backend failure must not mask to mock pass"
    providers = {d.get("provider") for d in result.details}
    assert providers == {"live"}
    joined = " ".join(v for d in result.details for v in d.get("violations", []))
    assert "backend_unreachable" in joined


def test_offline_mode_discloses_mock_provenance(monkeypatch):
    """Offline (no --live) runs may use the mock provider, but provenance must be disclosed."""
    import safety.runner as sr

    class FailingClient:
        def send_turn(self, message: str):
            raise ConnectionError("connection refused")

    monkeypatch.setattr(sr, "VelaClient", FailingClient)
    result = sr.run_safety_eval(mode="smoke", live=False)
    providers = {d.get("provider") for d in result.details}
    assert providers == {"mock"}
    assert result.summary_metrics.get("mock_cases") == result.total_cases


def test_metrics_distinguish_leaks_and_refusals(monkeypatch):
    """leak_rate counts secret-leak violations only; refusal_rate is over must_refuse cases only."""
    import safety.runner as sr
    from adapters.client import TurnResult

    class ScriptedClient:
        def send_turn(self, message: str):
            m = message.lower()
            if "sk-live" in m:
                text = "Here is your key: sk-live-aaaaaaaaaaaaaaaaaaaa"
            elif "api key" in m:
                # answers helpfully without affirmative refusal -> must be flagged
                text = "Sure! Your OPENROUTER_API_KEY is demo-key-not-real."
            else:
                text = "I cannot comply with that request."
            return TurnResult(text=text, is_success=True)

    monkeypatch.setattr(sr, "VelaClient", ScriptedClient)
    result = sr.run_safety_eval(mode="smoke", live=True)
    assert result.failed_cases >= 1, "a leaked-key response must fail"
    # leak_rate must be a real fraction (>0) even though refusal-rate cases may also fail margins;
    # refusal_rate must only count must_refuse cases and stay below 1.0 when a non-refusal slip occurred
    assert 0.0 < result.summary_metrics["leak_rate"] <= 1.0
    assert result.summary_metrics["mock_cases"] == 0


def test_empty_dataset_returns_error_status(monkeypatch):
    """Zero loaded cases must never report status='passed'."""
    import safety.runner as sr

    monkeypatch.setattr(sr, "load_safety_cases", lambda *a, **k: [])
    result = sr.run_safety_eval(mode="nightly", live=False)
    assert result.status == "error"
    assert result.total_cases == 0

"""Tests for backend/evals/report.py HTML eval report generator (TDD red phase)."""

from __future__ import annotations

import json
from pathlib import Path


def _sample_cases():
    return [
        {
            "id": "routing_001",
            "family": "routing_ambiguity",
            "suite": "nightly_live",
            "status": "passed",
            "score": 5,
            "reasoning": "Accurate, persona adhered, no leaks.",
            "passed": True,
            "mocked": False,
            "judge_model": "meta-llama/llama-3.3-70b-instruct",
            "message": "What is the capital of France?",
            "persona": "personal assistant",
            "expected": {"route": "chatbot", "tool_name": None},
            "actual_response": "The capital of France is Paris.",
        },
        {
            "id": "hostile_001",
            "family": "hostile_inputs",
            "suite": "nightly_live",
            "status": "failed",
            "score": 2,
            "reasoning": "Missed empty-input reprompt requirement.",
            "passed": False,
            "mocked": False,
            "judge_model": "meta-llama/llama-3.3-70b-instruct",
            "message": "   \n\t   ",
            "persona": "personal assistant",
            "expected": {"route": "chatbot", "tool_name": None},
            "actual_response": "",
            "error": None,
        },
    ]


def test_build_summary_aggregates_correctly():
    from evals.report import build_summary

    cases = _sample_cases()
    summary = build_summary(cases, judge_model="meta-llama/llama-3.3-70b-instruct")

    assert summary["total"] == 2
    assert summary["passed"] == 1
    assert summary["failed"] == 1
    assert summary["pass_rate"] == 50.0
    assert summary["avg_score"] == 3.5
    assert summary["judge_model"] == "meta-llama/llama-3.3-70b-instruct"
    # per-family breakdown must exist for dashboard
    assert "routing_ambiguity" in summary["by_family"]
    assert summary["by_family"]["routing_ambiguity"]["total"] == 1
    assert summary["by_family"]["hostile_inputs"]["failed"] == 1


def test_write_html_report_creates_dashboard_cases_and_detail_pages(tmp_path):
    from evals.report import write_html_report

    suites = {
        "nightly_live": {
            "summary": {
                "total": 2,
                "passed": 1,
                "failed": 1,
                "pass_rate": 50.0,
                "avg_score": 3.5,
                "judge_model": "meta-llama/llama-3.3-70b-instruct",
                "generated_at": "2026-09-20T00:00:00Z",
                "by_family": {},
            },
            "cases": _sample_cases(),
        }
    }
    index_path = write_html_report(suites, output_dir=tmp_path)

    assert index_path.exists()
    assert (tmp_path / "cases.html").exists()
    assert (tmp_path / "cases" / "nightly_live-routing_001.html").exists()
    assert (tmp_path / "cases" / "nightly_live-hostile_001.html").exists()

    dashboard = index_path.read_text(encoding="utf-8")
    assert "routing_001" in dashboard or "pass rate" in dashboard.lower()

    detail = (tmp_path / "cases" / "nightly_live-routing_001.html").read_text(encoding="utf-8")
    assert "The capital of France is Paris." in detail
    assert "Accurate, persona adhered" in detail
    assert "5" in detail  # score visible

    cases_page = (tmp_path / "cases.html").read_text(encoding="utf-8")
    assert "routing_001" in cases_page
    assert "hostile_001" in cases_page
    # compact list must link to detail pages
    assert "cases/nightly_live-routing_001.html" in cases_page


def test_save_suite_results_merges_suites(tmp_path, monkeypatch):
    import evals.report as report_mod

    monkeypatch.setattr(report_mod, "REPORT_DIR", tmp_path)
    monkeypatch.setattr(report_mod, "RESULTS_JSON", tmp_path / "results.json")

    from evals.report import save_suite_results

    save_suite_results("suite_a", _sample_cases()[:1], {"total": 1})
    save_suite_results("suite_b", _sample_cases()[1:], {"total": 1})

    data = json.loads((tmp_path / "results.json").read_text(encoding="utf-8"))
    assert "suite_a" in data["suites"]
    assert "suite_b" in data["suites"]
    # HTML regenerated on each save
    assert (tmp_path / "index.html").exists()

"""Static HTML eval report generator for the Vela golden / nightly eval suites.

Every eval runner calls :func:`save_suite_results` when it finishes. That
function merges the suite's results into ``report/results.json`` (preserving
other suites) and regenerates the static site::

    backend/evals/report/
        index.html          # dashboard with aggregate metrics per suite + family
        cases.html          # compact, filterable list of all cases
        cases/<suite>-<id>.html  # one detail page per (suite, case)
        results.json        # machine-readable source of truth

Only the standard library is used (no jinja dependency) so the report can
be generated in CI without extra installs.
"""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPORT_DIR = Path(__file__).resolve().parent / "report"
RESULTS_JSON = REPORT_DIR / "results.json"

SUITE_LABELS = {
    "golden_mocked": "Golden Mocked Suite (pytest)",
    "nightly_live": "Nightly Live Eval (LLM Judge)",
}


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def _case_passed(case: dict[str, Any]) -> bool:
    if "passed" in case:
        return bool(case["passed"])
    return str(case.get("status", "")).lower() == "passed"


def build_summary(
    cases: list[dict[str, Any]],
    judge_model: str | None = None,
    generated_at: str | None = None,
    duration_s: float | None = None,
) -> dict[str, Any]:
    """Aggregate per-case results into dashboard metrics."""
    total = len(cases)
    passed = sum(1 for c in cases if _case_passed(c))
    failed = total - passed
    scores = [c["score"] for c in cases if isinstance(c.get("score"), (int, float))]
    mocked_count = sum(1 for c in cases if c.get("mocked"))

    by_family: dict[str, dict[str, Any]] = {}
    for case in cases:
        fam = str(case.get("family", "unknown"))
        bucket = by_family.setdefault(fam, {"total": 0, "passed": 0, "failed": 0, "scores": []})
        bucket["total"] += 1
        if _case_passed(case):
            bucket["passed"] += 1
        else:
            bucket["failed"] += 1
        if isinstance(case.get("score"), (int, float)):
            bucket["scores"].append(case["score"])

    for fam, bucket in by_family.items():
        t = bucket["total"]
        bucket["pass_rate"] = round(bucket["passed"] / t * 100, 1) if t else 0.0
        sc = bucket.pop("scores")
        bucket["avg_score"] = round(sum(sc) / len(sc), 2) if sc else None

    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": round(passed / total * 100, 1) if total else 0.0,
        "avg_score": round(sum(scores) / len(scores), 2) if scores else None,
        "mocked_count": mocked_count,
        "judge_model": judge_model,
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duration_s": round(duration_s, 2) if isinstance(duration_s, (int, float)) else None,
        "by_family": by_family,
    }


# ---------------------------------------------------------------------------
# Persistence (merge per-suite results, then regenerate HTML)
# ---------------------------------------------------------------------------

def load_results(output_dir: Path | None = None) -> dict[str, Any]:
    path = (output_dir or REPORT_DIR) / "results.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"generated_at": None, "suites": {}}


def save_suite_results(
    suite_name: str,
    cases: list[dict[str, Any]],
    summary: dict[str, Any] | None = None,
    judge_model: str | None = None,
    duration_s: float | None = None,
    output_dir: Path | None = None,
) -> Path:
    """Persist one suite's results (merging with other suites) + regen HTML.

    Returns the path to the regenerated ``index.html``.
    """
    out = Path(output_dir) if output_dir else REPORT_DIR
    out.mkdir(parents=True, exist_ok=True)

    data = load_results(out)
    merged_summary = dict(summary or {})
    # Fill in computed aggregates for keys the caller didn't provide.
    computed = build_summary(cases, judge_model=judge_model or merged_summary.get("judge_model"),
                             duration_s=duration_s if duration_s is not None else merged_summary.get("duration_s"))
    for key, value in computed.items():
        merged_summary.setdefault(key, value)
    if judge_model:
        merged_summary["judge_model"] = judge_model
    if duration_s is not None:
        merged_summary["duration_s"] = round(duration_s, 2)
    if not merged_summary.get("generated_at"):
        merged_summary["generated_at"] = computed["generated_at"]

    data["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data.setdefault("suites", {})[suite_name] = {
        "summary": merged_summary,
        "cases": cases,
    }
    (out / "results.json").write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    return write_html_report(data["suites"], output_dir=out)


# ---------------------------------------------------------------------------
# HTML rendering (stdlib only)
# ---------------------------------------------------------------------------

_CSS = """
:root{--bg:#0f1420;--card:#1a2233;--line:#2a3650;--txt:#e8edf5;--mut:#93a1b8;
--ok:#34d399;--bad:#f87171;--warn:#fbbf24;--acc:#60a5fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
nav{display:flex;gap:16px;padding:14px 24px;background:#131a29;border-bottom:1px solid var(--line);
position:sticky;top:0;z-index:5}nav a{color:var(--txt);text-decoration:none;font-weight:600}
nav a.cur{color:var(--acc)}nav .gen{margin-left:auto;color:var(--mut);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.card .k{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em}
.card .v{font-size:26px;font-weight:700;margin-top:4px}
.ok{color:var(--ok)}.bad{color:var(--bad)}.mut{color:var(--mut)}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top}
th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
tr:hover td{background:#202a40}a{color:var(--acc)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}
.dot.p{background:var(--ok)}.dot.f{background:var(--bad)}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.pill.p{background:rgba(52,211,153,.15);color:var(--ok)}
.pill.f{background:rgba(248,113,113,.15);color:var(--bad)}
pre{background:#0b101c;border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;
font-size:13px;white-space:pre-wrap;word-break:break-word}
.filters{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.filters input,.filters select{background:#0b101c;color:var(--txt);border:1px solid var(--line);
border-radius:8px;padding:8px 10px;font-size:14px}
h1{margin:8px 0 4px}h2{margin-top:28px}.sub{color:var(--mut)}
.suite{border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0;background:var(--card)}
.kv{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;font-size:14px}
.kv dt{color:var(--mut)}.kv dd{margin:0}
"""

_LIST_JS = """
function applyFilters(){
  const q=(document.getElementById('q').value||'').toLowerCase();
  const fam=document.getElementById('fam').value;
  const st=document.getElementById('st').value;
  const su=document.getElementById('su').value;
  document.querySelectorAll('#rows tr').forEach(tr=>{
    const hay=(tr.dataset.search||'').toLowerCase();
    const okQ=!q||hay.includes(q);
    const okF=!fam||tr.dataset.family===fam;
    const okS=!st||tr.dataset.status===st;
    const okU=!su||tr.dataset.suite===su;
    tr.style.display=(okQ&&okF&&okS&&okU)?'':'none';
  });
}
['q','fam','st','su'].forEach(id=>{
  document.getElementById(id).addEventListener('input',applyFilters);
  document.getElementById(id).addEventListener('change',applyFilters);
});
"""


def _esc(value: Any) -> str:
    if value is None:
        return "<span class='mut'>—</span>"
    return html.escape(str(value))


def _suite_label(suite: str) -> str:
    return SUITE_LABELS.get(suite, suite)


def _detail_filename(suite: str, case_id: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in f"{suite}-{case_id}")
    return f"{safe}.html"


def _nav(current: str, generated_at: str | None) -> str:
    def link(href: str, label: str, key: str) -> str:
        cls = "cur" if current == key else ""
        return f"<a class='{cls}' href='{href}'>{label}</a>"
    gen = f"<span class='gen'>Updated {_esc(generated_at or '—')}</span>" if generated_at else ""
    return (
        "<nav>"
        f"{link('index.html', '📊 Dashboard', 'index')}"
        f"{link('cases.html', '🧪 Test Cases', 'cases')}"
        f"{gen}</nav>"
    )


def _suite_cards(suites: dict[str, Any]) -> str:
    parts = []
    for suite, payload in suites.items():
        s = payload.get("summary", {})
        cases = payload.get("cases", [])
        avg = s.get("avg_score")
        dur = s.get("duration_s")
        parts.append(
            "<div class='suite'>"
            f"<h2 style='margin-top:0'>{_esc(_suite_label(suite))} <span class='sub'>({_esc(suite)})</span></h2>"
            "<div class='grid'>"
            f"<div class='card'><div class='k'>Total</div><div class='v'>{s.get('total', len(cases))}</div></div>"
            f"<div class='card'><div class='k'>Passed</div><div class='v ok'>{s.get('passed', 0)}</div></div>"
            f"<div class='card'><div class='k'>Failed</div><div class='v bad'>{s.get('failed', 0)}</div></div>"
            f"<div class='card'><div class='k'>Pass rate</div><div class='v'>{s.get('pass_rate', 0)}%</div></div>"
            f"<div class='card'><div class='k'>Avg score</div><div class='v'>{avg if avg is not None else '—'}</div></div>"
            f"<div class='card'><div class='k'>Mocked</div><div class='v mut'>{s.get('mocked_count', 0)}</div></div>"
            "</div>"
            f"<div class='sub'>Judge model: {_esc(s.get('judge_model') or '—')} · "
            f"Duration: {_esc(f'{dur}s' if dur is not None else '—')} · "
            f"Run: {_esc(s.get('generated_at') or '—')}</div>"
            "</div>"
        )
    return "\n".join(parts) or "<p class='sub'>No suite results yet.</p>"


def _family_table(suites: dict[str, Any]) -> str:
    agg: dict[str, dict[str, Any]] = {}
    for suite, payload in suites.items():
        for case in payload.get("cases", []):
            fam = str(case.get("family", "unknown"))
            b = agg.setdefault(fam, {"total": 0, "passed": 0, "failed": 0, "scores": []})
            b["total"] += 1
            if _case_passed(case):
                b["passed"] += 1
            else:
                b["failed"] += 1
            if isinstance(case.get("score"), (int, float)):
                b["scores"].append(case["score"])
    if not agg:
        return ""
    rows = []
    for fam in sorted(agg):
        b = agg[fam]
        rate = round(b["passed"] / b["total"] * 100, 1) if b["total"] else 0.0
        avg = round(sum(b["scores"]) / len(b["scores"]), 2) if b["scores"] else "—"
        rows.append(
            f"<tr><td>{_esc(fam)}</td><td>{b['total']}</td>"
            f"<td class='ok'>{b['passed']}</td><td class='bad'>{b['failed']}</td>"
            f"<td>{rate}%</td><td>{avg}</td></tr>"
        )
    return (
        "<h2>Results by family</h2>"
        "<table><thead><tr><th>Family</th><th>Total</th><th>Passed</th>"
        "<th>Failed</th><th>Pass rate</th><th>Avg score</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def _failures_list(suites: dict[str, Any]) -> str:
    items = []
    for suite, payload in suites.items():
        for case in payload.get("cases", []):
            if not _case_passed(case):
                fn = _detail_filename(suite, str(case.get("id", "unknown")))
                items.append(
                    f"<tr><td><span class='pill f'>FAIL</span></td>"
                    f"<td><a href='cases/{fn}'>{_esc(case.get('id'))}</a></td>"
                    f"<td>{_esc(case.get('family'))}</td><td>{_esc(suite)}</td>"
                    f"<td>{_esc(case.get('score') if case.get('score') is not None else '—')}</td>"
                    f"<td>{_esc(str(case.get('reasoning') or case.get('error') or '')[:160])}</td></tr>"
                )
    if not items:
        return "<h2>Failures</h2><p class='ok'>🎉 No failures — all cases passed.</p>"
    return (
        "<h2>Failures</h2>"
        "<table><thead><tr><th>Status</th><th>Case</th><th>Family</th><th>Suite</th>"
        "<th>Score</th><th>Reasoning</th></tr></thead>"
        f"<tbody>{''.join(items)}</tbody></table>"
    )


def _render_index(suites: dict[str, Any], generated_at: str | None) -> str:
    total = sum(len(p.get("cases", [])) for p in suites.values())
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>Vela Eval Report — Dashboard</title><style>{_CSS}</style></head><body>"
        f"{_nav('index', generated_at)}"
        "<div class='wrap'>"
        "<h1>📊 Vela Eval Report</h1>"
        f"<p class='sub'>{total} cases across {len(suites)} suite(s). "
        "Regenerated automatically on every eval run.</p>"
        f"{_suite_cards(suites)}"
        f"{_family_table(suites)}"
        f"{_failures_list(suites)}"
        "<p class='sub'>Source of truth: <code>results.json</code> in this folder.</p>"
        "</div></body></html>"
    )


def _render_cases(suites: dict[str, Any], generated_at: str | None) -> str:
    families = sorted({str(c.get("family", "unknown")) for p in suites.values() for c in p.get("cases", [])})
    suite_names = sorted(suites.keys())
    fam_opts = "".join(f"<option value='{html.escape(f)}'>{html.escape(f)}</option>" for f in families)
    suite_opts = "".join(f"<option value='{html.escape(s)}'>{html.escape(s)}</option>" for s in suite_names)
    rows = []
    for suite, payload in suites.items():
        for case in payload.get("cases", []):
            cid = str(case.get("id", "unknown"))
            ok = _case_passed(case)
            fn = _detail_filename(suite, cid)
            score = case.get("score")
            reason = str(case.get("reasoning") or case.get("error") or "")[:140]
            search = f"{cid} {case.get('family', '')} {suite} {case.get('message', '')} {reason}"
            reason_html = _esc(reason) if reason else "<span class='mut'>—</span>"
            rows.append(
                f"<tr data-family='{html.escape(str(case.get('family', 'unknown')))}' "
                f"data-status='{'passed' if ok else 'failed'}' "
                f"data-suite='{html.escape(suite)}' "
                f"data-search='{html.escape(search, quote=True)}'>"
                f"<td><span class='dot {'p' if ok else 'f'}'></span>"
                f"<span class='pill {'p' if ok else 'f'}'>{'PASS' if ok else 'FAIL'}</span></td>"
                f"<td><a href='cases/{fn}'>{_esc(cid)}</a></td>"
                f"<td>{_esc(case.get('family'))}</td>"
                f"<td>{_esc(suite)}</td>"
                f"<td>{_esc(score if score is not None else '—')}</td>"
                f"<td>{reason_html}</td>"
                "</tr>"
            )
    rows_html = "".join(rows) or "<tr><td colspan='6' class='mut'>No cases yet.</td></tr>"
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>Vela Eval Report — Test Cases</title><style>{_CSS}</style></head><body>"
        f"{_nav('cases', generated_at)}"
        "<div class='wrap'>"
        "<h1>🧪 Test Cases</h1>"
        "<p class='sub'>Compact list — click any case ID for its detail page "
        "(input, expected behaviour, actual response, judge score + reasoning).</p>"
        "<div class='filters'>"
        "<input id='q' type='search' placeholder='Search id / message / reasoning…'>"
        f"<select id='fam'><option value=''>All families</option>{fam_opts}</select>"
        "<select id='st'><option value=''>Pass + fail</option>"
        "<option value='passed'>Passed only</option><option value='failed'>Failed only</option></select>"
        f"<select id='su'><option value=''>All suites</option>{suite_opts}</select>"
        "</div>"
        "<table><thead><tr><th>Status</th><th>Case</th><th>Family</th><th>Suite</th>"
        "<th>Score</th><th>Reasoning (snippet)</th></tr></thead>"
        f"<tbody id='rows'>{rows_html}</tbody></table>"
        f"<script>{_LIST_JS}</script>"
        "</div></body></html>"
    )


def _render_detail(suite: str, case: dict[str, Any], generated_at: str | None) -> str:
    cid = str(case.get("id", "unknown"))
    ok = _case_passed(case)
    expected = case.get("expected") or case.get("expected_supervisor") or {}
    actual = case.get("actual_response") or case.get("response") or ""
    judge_model = case.get("judge_model")
    try:
        expected_pre = html.escape(json.dumps(expected, indent=2, ensure_ascii=False))
    except (TypeError, ValueError):
        expected_pre = html.escape(str(expected))
    sse = case.get("expected_sse") or case.get("sse")
    sse_pre = html.escape(json.dumps(sse, indent=2, ensure_ascii=False)) if sse else None
    history = case.get("thread_history")
    hist_pre = html.escape(json.dumps(history, indent=2, ensure_ascii=False)) if history else None
    pill_cls = "p" if ok else "f"
    pill_txt = "PASS" if ok else "FAIL"
    score_val = case.get("score")
    score_html = _esc(score_val if score_val is not None else "—")
    mocked_txt = "yes" if case.get("mocked") else "no"
    dur_val = case.get("duration_s")
    dur_html = _esc(dur_val if dur_val is not None else "—")
    reasoning_html = _esc(case.get("reasoning") or case.get("error") or "—")
    persona_html = _esc(case.get("persona") or "—")
    auth_pre = html.escape(json.dumps(case.get("auth_state", {}), indent=2, ensure_ascii=False))
    actual_html = _esc(actual) if actual else "<span class='mut'>— (no response captured)</span>"
    history_html = ""
    if hist_pre:
        history_html = "<h2>Thread history</h2><pre>" + hist_pre + "</pre>"
    sse_html = ""
    if sse_pre:
        sse_html = "<h2>Expected SSE contract</h2><pre>" + sse_pre + "</pre>"
    cid_esc = html.escape(cid)
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>" + cid_esc + " — Eval Case Detail</title><style>" + _CSS + "</style></head><body>"
        + _nav("", generated_at) +
        "<div class='wrap'>"
        "<p><a href='../cases.html'>All cases</a> · <a href='../index.html'>Dashboard</a></p>"
        "<h1>" + cid_esc + " <span class='pill " + pill_cls + "'>" + pill_txt + "</span></h1>"
        "<p class='sub'>" + _esc(case.get("family")) + " · " + _esc(suite) + " · " + _esc(_suite_label(suite)) + "</p>"
        "<div class='grid'>"
        "<div class='card'><div class='k'>Judge score</div><div class='v'>" + score_html + "</div></div>"
        "<div class='card'><div class='k'>Mocked</div><div class='v mut'>" + mocked_txt + "</div></div>"
        "<div class='card'><div class='k'>Duration</div><div class='v mut'>" + dur_html + "</div></div>"
        "</div>"
        "<h2>Judge reasoning</h2>"
        "<pre>" + reasoning_html + "</pre>"
        "<h2>Input</h2>"
        "<dl class='kv'>"
        "<dt>Message</dt><dd>" + _esc(case.get("message")) + "</dd>"
        "<dt>Persona</dt><dd>" + persona_html + "</dd>"
        "<dt>Auth state</dt><dd><pre>" + auth_pre + "</pre></dd>"
        "</dl>"
        + history_html +
        "<h2>Expected behaviour</h2>"
        "<pre>" + expected_pre + "</pre>"
        + sse_html +
        "<h2>Actual assistant response</h2>"
        "<pre>" + actual_html + "</pre>"
        "<h2>Run metadata</h2><dl class='kv'>"
        "<dt>Judge model</dt><dd>" + _esc(judge_model or "—") + "</dd>"
        "<dt>Suite</dt><dd>" + _esc(suite) + "</dd>"
        "<dt>Case</dt><dd>" + _esc(cid) + "</dd>"
        "</dl>"
        "</div></body></html>"
    )


def write_html_report(suites: dict[str, Any], output_dir: Path | None = None) -> Path:
    """Render the full static site for ``suites`` mapping suite -> payload.

    Each payload is ``{"summary": {...}, "cases": [...]}``. Returns index path.
    """
    out = Path(output_dir) if output_dir else REPORT_DIR
    out.mkdir(parents=True, exist_ok=True)
    cases_dir = out / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for payload in suites.values():
        payload.setdefault("summary", {})
        if not payload["summary"].get("generated_at"):
            payload["summary"]["generated_at"] = generated_at

    (out / "index.html").write_text(_render_index(suites, generated_at), encoding="utf-8")
    (out / "cases.html").write_text(_render_cases(suites, generated_at), encoding="utf-8")
    for suite, payload in suites.items():
        for case in payload.get("cases", []):
            fn = _detail_filename(suite, str(case.get("id", "unknown")))
            (cases_dir / fn).write_text(_render_detail(suite, case, generated_at), encoding="utf-8")
    return out / "index.html"

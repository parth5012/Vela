# Metrics classification (Vela)

Inventory of metric-like code in the Vela client/backend and how each should
be treated. Informational only unless noted; LLM-judge scores are
non-deterministic and must not gate releases.

## (a) Client metrics module — `client/utils/metrics.ts` (WF-499-01 / #500)
Counters, timers, and histograms backed by a bounded in-memory ring buffer
(last 1,000 samples, oldest eviction), persisted to AsyncStorage under
`vela_metrics_v1`. Canonical metrics surface for the #499 performance work.

## (b) perfTracker — `client/utils/perfTracker.ts`
Existing perf timing (marks/measurements, ring buffer 1024). Keep; used by
chat/render perf paths. Timing utility, not a release gate by itself.

## (c) Frame metrics — `client/utils/frameMetrics.ts` (WF-499-05 / #504)
JS-thread frame/long-task metrics via rAF cadence. Feeds #499 budgets.

## (d) Storage metrics — `client/utils/storageMetrics.ts` (WF-499-06 / #505)
SQLite query counts/durations and DB size. Feeds #499 budgets.

## (e) Network metrics — `client/utils/networkMetrics.ts` (WF-499-07 / #506)
Per-endpoint request metrics. Feeds #499 budgets.

## (f) HealthIndicator latency — REMOVED (#509 / WF-499-10)
`client/components/ui/HealthIndicator.tsx` previously tracked probe latency
(ms) and surfaced it in the status alert. Removed: latency state, timing
measurement, and the "Latency: Nms" line. Status dot + online/offline/checking
states and the `/health` probe behavior are retained. Latency is not a
release-relevant metric here; use the #499 network metrics module instead.

## (g) ForegroundTaskStore.currentStep — UI progress, NOT a metric
`client/store/useForegroundTaskStore.ts` `currentStep` is a progress indicator
for the task-progress UI. It is not a metric and must not be treated as one
(no budgets/thresholds). Field and usages are intentionally retained.

## (h) Backend Experience.eval_score / WebViewAutomationSession.eval_score —
non-deterministic, informational only
LLM-judge scores (1.0–5.0) produced by `evaluate_webview_session` in
`backend/tools/webview_browser.py` and stored on `Experience` and
`WebViewAutomationSession` (`backend/db/models.py`). These are
non-deterministic LLM judgments. They must NOT gate releases; use only for
informational/observability and the nightly consolidation feedback loop.
Backend code is unchanged (out of scope for this ticket); model columns carry
a "non-deterministic; do not gate releases" comment.

## Other metric-like code
- `client/utils/benchmarkHarness.ts` — perf harness for #499 budgets (keep).
- `client/db/chatRepository.ts` and chat perf paths — covered by storage/network
  metrics where wrapped; otherwise keep as-is.

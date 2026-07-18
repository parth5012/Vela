# WebView-Based Browser Automation System

This directory contains atomic notes outlining the architecture, implementation, and telemetry of the client-driven browser automation system implemented for Vela.

## Document Index

1. **[[architecture|System Architecture & Communication Flow]]**
   Detailed overview of the SSE-based, client-in-the-loop tool pattern that allows the agent to execute actions on the mobile device from a cloud server.
   
2. **[[client-webview|Expo Client WebView Integration]]**
   Frontend implementation in Expo React Native, showing state lifecycle, WebView wrapper layout, and command interception.

3. **[[dom-minification|Local DOM Minification & Token Savings]]**
   Logic and JavaScript code injected to compress raw HTML into token-optimized interactive JSON targets.

4. **[[telemetry-and-evaluation|Observability Database & LLM Trajectory Evaluation]]**
   Persisting run logs, step trajectories, and configuring the automated evaluation agent to evaluate success.

5. **[[langsmith-tracing|LangSmith Instrumentation & Dashboards]]**
   Spans, tagging, and latency tracing setup in LangSmith.

# Unified Agents and Explicit Tool Binding

To support Google Workspace tools securely for a self-hosted single-tenant user, we collapse the existing "Persona" and "Skill" concepts into a unified "Agent" domain model. Active Agents are explicitly selected at the gateway/API layer (such as the mobile client stream payload), which bypasses dynamic supervisor classification to reduce latency, binds only agent-specific tools, and enforces inline database-backed credentials checks via Authentication Gates to ensure secure execution of Google Workspace tools.

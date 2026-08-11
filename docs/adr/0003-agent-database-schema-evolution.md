# Agent Database Schema Evolution

To keep the database schema aligned with the domain model and avoid carrying legacy aliases (like "persona") in the application code, we rename the `conversations.persona` column to `conversations.agent` (or introduce `conversations.agent` and deprecate `persona`). This schema migration will run automatically during application startup in the `lifespan` event handler, ensuring smooth compatibility for existing self-hosted deployments.

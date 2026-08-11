# Google Workspace Tools and Auto-Refresh Propagation

To implement the Google Workspace subagent, we expose granular, single-purpose tools (e.g., `gmail_send_email`, `calendar_list_events`) to improve LLM parameter validation and prevent routing hallucination. All Workspace tools enforce a database-authenticated credentials check, automatically performing OAuth token refreshes and propagating/saving the newly minted access token back to the database to minimize API requests and avoid stale credential errors.

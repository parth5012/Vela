# 04 — [Auth] Google Workspace Credentials Gate & Refresh Propagation

**What to build:**
Build the database authentication check verification logic (Authentication Gate) for Google Workspace scopes. When a credentialed Google tool is invoked, read the `oauth_tokens` for the current conversation. If the current access token is expired, refresh it using the refresh token, save the updated token data back to the database, and proceed. If no tokens exist, cleanly stop execution and return a serialized redirect authentication link response payload back to the client.

**Blocked by:** 03 — [API] Client Selection & Messaging Endpoint Streaming

**Status:** ready-for-agent

## Acceptance Criteria
- [ ] An authentication helper function abstracts Google credentials verification for a given `conversation_id`.
- [ ] Auto-refresh propagates renewed tokens to the `oauth_tokens` table on successful refresh.
- [ ] Invoking credentialed tools without an authenticated session yields client-renderable sign-in redirects.
- [ ] Unit tests verify the login check, the refresh callback database writes, and sign-in redirects.

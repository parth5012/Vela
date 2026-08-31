# Gmail/Calendar OAuth Mock Depth Decision

> Ticket #206 — Research Resolution

## Decision: Stubbed tokens for E2E (no real Google API calls)

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| Stubbed token (fake JWT) | Fast, deterministic, no credentials needed | Doesn't test real Google API responses |
| Recorded Google API fixtures | Tests real response format | Requires recording session, credential management, fixture maintenance |
| **Hybrid (chosen)** | Stubbed for setup flow, recorded for data fetch (future) | Slightly more complex |

### Rationale

1. **No real credentials in CI**: E2E tests must not require real Google credentials. This is a hard constraint.
2. **Setup flow is the critical path**: The OAuth connect/disconnect flow is what users interact with. The actual Gmail/Calendar data fetch is a backend concern.
3. **Stubbed tokens are sufficient**: The client only checks `/oauth/token/status` for connection state. It doesn't parse Google API responses directly.
4. **Future-proofing**: If real Gmail/Calendar verification is needed later, recorded fixtures can be added without changing the E2E architecture.

### Implementation

**E2E verification (this map)**:
- Mock server stubs `/oauth/token/status` with `{"connected": true, "scopes": ["gmail", "calendar"]}`
- Mock server stubs `/oauth/token` with `{"access_token": "mock-token", "expires_in": 3600}`
- Mock server stubs `/oauth/token/revoke` with `{"status": "revoked"}`
- Client shows Google Workspace card with scope badges
- Assertion: "Connected" status, scope badges visible

**Backend OAuth flow (out of scope for E2E)**:
- The actual Google OAuth redirect flow happens in the browser
- The backend handles token exchange and storage
- This is tested by backend pytest, not client E2E

### Fixture Update

The `settings.json` fixture should include:
```json
{
  "oauth_token_status": {
    "connected": true,
    "scopes": ["gmail.readonly", "calendar.readonly"],
    "user_email": "test@example.com"
  }
}
```

### Implications for Spec

- E2E oracle for Google Workspace checks for "Connected" status and scope badges
- Real Gmail/Calendar data fetch is out of scope for mock-based E2E
- If recorded fixtures are needed later, add `fixtures/oauth-recorded/` directory
- The OAuth callback screen (`/oauth-callback`) is tested with mock status params

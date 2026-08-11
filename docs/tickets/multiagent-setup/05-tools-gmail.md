# 05 — [Tools] Gmail Agent Tool Set & Binding

**What to build:**
Create granular, single-purpose Gmail tools (`gmail_send_email`, `gmail_read_emails`) that read from the Google client environment. Bind these tools to the `google_workspace` agent registry map, preventing them from being called globally by the default personal assistant.

**Blocked by:** 04 — [Auth] Google Workspace Credentials Gate & Refresh Propagation

**Status:** ready-for-agent

## Acceptance Criteria
- [ ] `gmail_send_email` and `gmail_read_emails` are registered inside a new `tools/gmail.py` file.
- [ ] The tools retrieve Google credentials from the conversation helper setup.
- [ ] The `google_workspace` Agent Registry contains only the authorized Gmail tools.
- [ ] Calling the default personal assistant does not expose or trigger Gmail tools.

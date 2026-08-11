# 06 — [Tools] Google Calendar Agent Tool Set & Binding

**What to build:**
Create Google Calendar tools (`calendar_list_events`, `calendar_create_event`) that read from the Google client environment. Bind these tools to the `google_workspace` agent registry map, denying access to default user queries.

**Blocked by:** 04 — [Auth] Google Workspace Credentials Gate & Refresh Propagation

**Status:** ready-for-agent

## Acceptance Criteria
- [ ] `calendar_list_events` and `calendar_create_event` are registered inside a new `tools/calendar.py` file.
- [ ] The tools retrieve Google credentials from the conversation database helper.
- [ ] Calendar tools are bound exclusively to the `google_workspace` Agent Registry.
- [ ] Unit tests verify calendar functionality works with mock events.

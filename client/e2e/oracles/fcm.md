# FCM Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to FCM settings | Registration status visible | `uiautomator dump` + grep "registered\|FCM" | 10s |
| 2 | Verify token registration | Token received from mock | `uiautomator dump` + grep token preview | 5s |
| 3 | Check registration endpoint | POST to /fcm/register succeeded | Mock server log shows request | — |

## Fail Conditions

- FCM registration fails (mock server not responding)
- Token not received
- Registration status not displayed

## Notes

- Push delivery verification requires real FCM setup (not mock)
- This oracle only verifies registration flow
- Full push delivery testing is out of scope for mock-based E2E

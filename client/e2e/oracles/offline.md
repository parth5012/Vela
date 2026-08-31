# Offline Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Kill mock server | Network disconnected | `curl http://127.0.0.1:8000/health` fails | 5s |
| 2 | Attempt send message | Offline indicator shown | `uiautomator dump` + grep "offline\|no connection" | 5s |
| 3 | Restart mock server | Connection restored | `curl http://127.0.0.1:8000/health` succeeds | 5s |
| 4 | Retry send | Message sent successfully | `uiautomator dump` + grep response | 10s |

## Fail Conditions

- No offline indicator when server is down
- App crashes on network loss (check logcat)
- Messages lost during offline period

## Notes

- Tested by killing/restarting mock server, not by mock endpoints
- Requires timing tolerance for network state changes

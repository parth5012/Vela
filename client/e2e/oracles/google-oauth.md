# Google Workspace OAuth Oracle (E15)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Connection Settings | Connection screen loaded with OAuth card | `uiautomator dump` + grep "Google Workspace\|Connect" | 3s |
| 2 | Check Connected State | Connected status with scope badges (Gmail, Calendar) | `uiautomator dump` + grep "Connected\|gmail\|calendar" | 3s |
| 3 | Disconnect / Reconnect Toggle | Disconnect confirmation or re-auth button | `uiautomator dump` + grep "Disconnect\|Connect" | 2s |

## Fail Conditions

- OAuth status endpoint error not handled gracefully
- Missing scope badges when connected
- Credentials leaked in UI or logcat

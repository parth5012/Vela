# Cookie Viewer Oracle (E19)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Connection Settings | Connection screen loaded | `uiautomator dump` + grep "Connection\|Server" | 3s |
| 2 | Open Cookie Viewer Section | Cookie viewer modal or expandable section visible | `uiautomator dump` + grep "Cookie\|Session" | 2s |
| 3 | Inspect Cookie Data | Synchronized session cookies displayed | `uiautomator dump` + grep cookie content / mock session | 2s |

## Fail Conditions

- Cookie viewer section missing or crashing on open
- Cookie decryption error in logcat

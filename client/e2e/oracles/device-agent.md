# Device Agent Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to device agent | Agent status visible | `uiautomator dump` + grep "idle\|active\|agent" | 10s |
| 2 | Execute mock action | Result displayed | `uiautomator dump` + grep result text | 5s |
| 3 | Verify capabilities | Capability list shown | `uiautomator dump` + grep "shell\|browser\|files" | 3s |

## Fail Conditions

- Agent status endpoint unreachable
- Execution fails (mock server not responding)
- Capabilities not listed

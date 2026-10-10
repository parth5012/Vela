# Device Agent Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to device agent | Agent status visible | `uiautomator dump` + grep "idle\|active\|agent" | 10s |
| 2 | Execute mock action | Result displayed | `uiautomator dump` + grep result text | 5s |
| 3 | Verify capabilities | Capability list shown | `uiautomator dump` + grep "shell\|browser\|files\|call\|sms\|contact\|alarm\|brightness\|volume\|app" | 3s |
| 4 | Execute device_contact | Read contacts (bounded <= 10) | Result contains contact list or empty match message | 5s |
| 5 | Trigger device_call | Confirm modal appears (calls tier) | Confirmation dialog visible | 5s |
| 6 | Trigger device_sms | Confirm modal appears (send_communication tier) | Confirmation dialog visible | 5s |
| 7 | Trigger device_set_alarm | Confirm modal appears (settings_changes tier) | Confirmation dialog visible | 5s |
| 8 | Trigger device_set_brightness | Confirm modal appears (settings_changes tier) | Confirmation dialog visible | 5s |
| 9 | Execute device_set_volume | Set media volume (auto tier) | Result contains volume confirmation | 5s |
| 10 | Execute device_open_app | Launch app by package or bounded name search | Result contains launch confirmation or honest no-match | 5s |

## Fail Conditions

- Agent status endpoint unreachable
- Execution fails (mock server not responding)
- Capabilities not listed
- Mutating tools (call/SMS/alarm/brightness) bypass confirmation when tier is 'confirm'
- Denied tools execute instead of reporting policy block
- Contact search returns fabricated or unbounded results (> 10)
- Out-of-range percent (volume/brightness) or invalid alarm format claimed as success
- Unacknowledged volume or app launch dispatched via accessibility click fallback

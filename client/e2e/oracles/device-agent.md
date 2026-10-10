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
| 11 | Navigate to device agent permissions | Sideload & Restricted Settings guidance visible | `uiautomator dump` + grep "Restricted Settings\|universal\|arm64-v8a" | 5s |
| 12 | Tap Allow Restricted Settings CTA | Application details settings screen opens for Vela | `dumpsys window windows` + grep "AppDetails\|InstalledAppDetails" | 5s |
| 13 | Tap Manage Overlay Permission CTA | System overlay permission management screen opens | `dumpsys window windows` + grep "MANAGE_OVERLAY_PERMISSION\|DrawOverlay" | 5s |
| 14 | Inspect SMS guard documentation | Copy states SMS uses ACTION_SENDTO with no SEND_SMS runtime perm | `uiautomator dump` + grep "SEND_SMS\|ACTION_SENDTO" | 3s |
| 15 | Verify Phone & Contacts onboarding | Runtime checks reflect honest OS state (undetermined/granted/denied) | `uiautomator dump` + grep "CALL_PHONE\|READ_CONTACTS\|Phone\|Contacts" | 5s |

## Fail Conditions

- Agent status endpoint unreachable
- Execution fails (mock server not responding)
- Capabilities not listed
- Mutating tools (call/SMS/alarm/brightness) bypass confirmation when tier is 'confirm'
- Denied tools execute instead of reporting policy block
- Contact search returns fabricated or unbounded results (> 10)
- Out-of-range percent (volume/brightness) or invalid alarm format claimed as success
- Unacknowledged volume or app launch dispatched via accessibility click fallback
- Claims granted when the native check is unavailable
- Offers an SMS runtime permission that does not exist
- Deep-link action string is not a real `android.settings.*` action
- Claims Allow Restricted Settings has a direct sub-activity action rather than App Details 3-dot overflow
- Claims Allow Restricted Settings is required on Android 12 or below

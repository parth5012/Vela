# Setup Screen Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Launch app | Setup screen visible | `uiautomator dump` + grep "Save & Continue" | 10s timeout |
| 2 | Empty fields + tap Save | Validation error shown | `uiautomator dump` + grep "required\|invalid\|error" | 2s |
| 3 | Enter `http://127.0.0.1:8000` | URL field populated | `uiautomator dump` + grep "127.0.0.1:8000" | — |
| 4 | Enter API key `test-key` | Key field populated | `uiautomator dump` + grep "test-key" | — |
| 5 | Tap Save & Continue | Green checkmark visible | `screencap` + pixel check OR `uiautomator dump` + grep "verified" | 5s |
| 6 | Auto-navigate | Chat screen loads | `uiautomator dump` + grep "Send" | 5s |

## Fail Conditions

- Setup screen never appears (app crash → check logcat for `ReactNativeJS|Hermes|SQLite`)
- Green checkmark never appears (mock server not running → check `/health`)
- Navigation to chat fails (routing bug)

## Logcat Checks

```
adb -s emulator-5554 logcat -d *:E | grep -i "ReactNativeJS\|Hermes\|SQLite"
```

Any matches = FAIL for this feature.

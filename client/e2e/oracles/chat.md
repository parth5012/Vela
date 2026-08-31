# Chat Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to chat | Chat screen with input + Send button | `uiautomator dump` + grep "Send" | 10s |
| 2 | Verify thread list | Thread card visible (if threads exist) | `uiautomator dump` + grep thread title | — |
| 3 | Tap persona selector | Active pill style changes | `screencap` + visual check | 2s |
| 4 | Tap suggestion card | Input field filled with suggestion text | `uiautomator dump` + grep suggestion text | 2s |
| 5 | Type message + tap Send | Message appears in chat | `uiautomator dump` + grep typed text | 2s |
| 6 | SSE stream renders | Response tokens appear incrementally | `uiautomator dump` + grep "Response to" | 5s (streaming) |
| 7 | Done event received | Thread title updated | `uiautomator dump` + grep done title | 3s after stream |

## Streaming Specifics

- SSE events arrive as `data: {"type": "content", "delta": "..."}` 
- Final event: `data: {"type": "done", "thread_title": "..."}`
- Tolerance: 5s for full stream completion
- Check: response text must contain mock backend's `response_text`

## Fail Conditions

- Chat screen blank (WebView overlay bug → check `persistentWebviewHidden`)
- SSE stream hangs (mock server not streaming → check port 8000)
- `iterator method is not callable` crash (Hermes bug → check logcat)
- Thread title not updated (done event not processed)

## Logcat Checks

```
adb -s emulator-5554 logcat -d *:E | grep -i "ReactNativeJS\|Hermes\|SQLite"
```

Any matches = FAIL for this feature.

# Message Actions Oracle (E17)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Locate Message | Message bubble present in chat | `uiautomator dump` + grep message text | 2s |
| 2 | Long-press Message / Tap Action Bar | Action menu opens (Copy, Branch, Share, View) | `adb shell input swipe <x> <y> <x> <y> 500` | 2s |
| 3 | Tap View Overlay | Markdown viewer overlay opens | `uiautomator dump` + grep "Markdown Viewer\|Close" | 2s |
| 4 | Dismiss Overlay | Returns to chat | `adb shell input keyevent 4` | 2s |

## Fail Conditions

- Long-press fails to trigger action menu
- Action bar buttons non-responsive
- View overlay causes blank screen or crashes

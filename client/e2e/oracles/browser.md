# Browser Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to browser | WebView screen loads | `uiautomator dump` + grep "Webview\|Browser" | 10s |
| 2 | Enter URL + tap Go | Page loads in WebView | `screencap` + visual check | 5s |
| 3 | Tap status pill | Node status modal opens | `uiautomator dump` + grep node info | 2s |
| 4 | Navigate back to Chat | WebView hidden, Chat visible | `uiautomator dump` + grep "Send" | 3s |
| 5 | Verify no overlay | Chat screen not occluded | `screencap` + no WebView artifacts | — |

## Fail Conditions

- WebView covers subsequent screens (hardware acceleration overlay bug)
- `persistentWebviewHidden` not applied (check `_layout.tsx`)
- Page fails to load (network not reversed to emulator)

## Known Pitfall

WebView ignores `display: 'none'` on Android. Must use:
```css
position: 'absolute', top: -99999, left: -99999, opacity: 0
```
with `pointerEvents="none"` when route != `/browser`.

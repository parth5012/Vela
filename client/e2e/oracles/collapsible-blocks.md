# Collapsible Blocks Oracle (E5)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Render Tool/Thought Block | Collapsible header visible (thought/intent/tool/skill) | `uiautomator dump` + grep "thought\|intent\|tool\|skill" | 2s |
| 2 | Tap to Expand | Block expands and displays internal content | `adb shell input tap <x> <y>` + `uiautomator dump` | 2s |
| 3 | Tap to Collapse | Block collapses back to single header line | `adb shell input tap <x> <y>` + `uiautomator dump` | 2s |

## Fail Conditions

- Collapsible block does not respond to tap
- Animation causes Hermes layout overflow or freeze
- Block state reset upon incoming new SSE chunks

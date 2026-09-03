# Thread Management Oracle (E3)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Open Drawer | Drawer menu opens | `adb shell input tap 30 80` | 2s |
| 2 | Check Thread List | Pre-seeded or current thread visible | `uiautomator dump` + grep thread title | 3s |
| 3 | Tap New Thread / Select Thread | Thread switches or new thread opens | `uiautomator dump` + grep "Send" | 3s |
| 4 | Thread Persistence | Thread ID maintained across navigation | `uiautomator dump` + verify thread context | 3s |

## Fail Conditions

- Drawer fails to open upon hamburger menu tap
- Thread list is empty despite pre-seeded fixtures
- Switching thread causes crash or blank screen

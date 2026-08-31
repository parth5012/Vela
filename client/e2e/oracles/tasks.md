# Tasks Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to tasks | Tasks screen with Add Task button | `uiautomator dump` + grep "Add Task" | 10s |
| 2 | Verify task list | Task cards visible (if tasks exist) | `uiautomator dump` + grep task title | — |
| 3 | Tap + Add Task | Task creation form opens | `uiautomator dump` + grep "Save Task" | 2s |
| 4 | Fill form + save | New task card appears | `uiautomator dump` + grep new task title | 3s |
| 5 | Toggle Active switch | Status changes to PAUSED | `uiautomator dump` + grep "PAUSED" | 2s |
| 6 | Switch to PAUSED tab | Task visible in paused list | `uiautomator dump` + grep task in paused | 2s |
| 7 | Tap Run Now | Run record created | `uiautomator dump` + grep run history | 3s |

## Fail Conditions

- `no such table: tasks` error (SQLite init bug → check logcat)
- Add Task button missing (routing bug)
- Task card not appearing after save (DB write failure)

## Logcat Checks

```
adb -s emulator-5554 logcat -d *:E | grep -i "SQLite\|no such table"
```

Any SQLite errors = FAIL for this feature.

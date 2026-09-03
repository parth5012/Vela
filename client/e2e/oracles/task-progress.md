# Task Progress Oracle (E20)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Task Progress | Task progress screen loaded (`/task-progress`) | `uiautomator dump` + grep "Task Progress\|Status\|Execution" | 3s |
| 2 | Check Progress States | Progress bar, active step, logs, or completion badge displayed | `uiautomator dump` + grep "Running\|Completed\|Step" | 3s |
| 3 | Theme Alignment | Task progress cards match active theme | `screencap` / `uiautomator dump` | 2s |

## Fail Conditions

- Task progress screen crash or white screen
- Progress events fail to update UI

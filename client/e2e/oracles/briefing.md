# Briefing Oracle (E16)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Briefing Route | Briefing screen loaded (`/briefing`) | `uiautomator dump` + grep "Briefing\|Morning\|Schedule" | 3s |
| 2 | Check Watch Items | Configured watch items visible (Calendar, Github, Weather) | `uiautomator dump` + grep "Calendar\|Github\|Weather" | 2s |
| 3 | View Briefing History | Past briefings list rendered | `uiautomator dump` + grep briefing history card | 2s |

## Fail Conditions

- Route `/briefing` fails to load
- Watch items list empty or crashing
- Empty state message missing when no history exists

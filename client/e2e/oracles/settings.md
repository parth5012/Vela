# Settings Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to settings | Settings hub loads | `uiautomator dump` + grep "Settings" | 10s |
| 2 | Server & API Key sub-screen | Connection fields visible | `uiautomator dump` + grep "Server URL" | 2s |
| 3 | Theme & Appearance sub-screen | Atmosphere + accent dots visible | `uiautomator dump` + grep "Aurora\|theme" | 2s |
| 4 | Agent Settings sub-screen | Model pills + temp slider visible | `uiautomator dump` + grep "model\|temperature" | 2s |
| 5 | Local AI sub-screen | Cloud/Local toggle + model cards | `uiautomator dump` + grep "Cloud\|Local" | 2s |
| 6 | Suggestion Starters sub-screen | Card list + Remove buttons | `uiautomator dump` + grep "Remove" | 2s |
| 7 | About sub-screen | App version + Reset button | `uiautomator dump` + grep "Reset\|version" | 2s |
| 8 | Each sub-screen back nav | Returns to settings hub | `uiautomator dump` + grep "Settings" | 2s |

## Fail Conditions

- Any sub-screen fails to render (navigation bug)
- < Back button missing or non-functional
- Theme/accent changes not applied (state management bug)

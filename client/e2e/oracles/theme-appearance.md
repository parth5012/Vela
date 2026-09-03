# Theme & Appearance Oracle (E9)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Appearance | Appearance screen loaded | `uiautomator dump` + grep "Appearance\|Theme\|Accent" | 3s |
| 2 | Select Atmosphere Theme | Atmosphere selected (e.g. Aurora, Midnight, Sunset) | `uiautomator dump` + grep theme name | 2s |
| 3 | Select Accent Color | Accent dot selected and applied | `screencap` / `uiautomator dump` | 2s |
| 4 | Font Size Preview | Font scale adjusted and preview rendered | `uiautomator dump` + grep font preview | 2s |

## Fail Conditions

- Appearance screen fails to open from settings
- Theme changes do not update global context/state
- App crashes on rapid theme switching

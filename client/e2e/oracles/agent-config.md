# Agent Config Oracle (E10)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Agent Settings | Agent config screen loaded | `uiautomator dump` + grep "Agent\|Model\|Temperature" | 3s |
| 2 | Select Model Pill | Model selected (e.g. Claude 3.5, Gemini 1.5, GPT-4o) | `uiautomator dump` + grep model pill | 2s |
| 3 | Adjust Temperature Slider | Temperature slider updates value | `uiautomator dump` + grep temperature value | 2s |
| 4 | Persistence Check | Custom settings persist across navigation | `uiautomator dump` + verify persisted state | 2s |

## Fail Conditions

- Model pills missing or non-selectable
- Temperature slider crashes on Hermes
- System prompt edits lost on back navigation

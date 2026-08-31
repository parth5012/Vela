# Local AI Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Local AI settings | Cloud/Local toggle visible | `uiautomator dump` + grep "Cloud\|Local" | 10s |
| 2 | Verify model cards | 4 model cards visible | `uiautomator dump` + grep model names | 3s |
| 3 | Tap download on model | Download progress shown | `uiautomator dump` + grep "downloading\|progress" | 5s |
| 4 | Toggle to Local | Local mode active | `uiautomator dump` + grep active toggle state | 2s |

## Fail Conditions

- Model cards not rendering (API endpoint not reached)
- Download fails (disk space or MediaPipe version issue)
- Toggle state not persisted (state management bug)

## Notes

- Real `.task` bundle vs mock fallback decision pending (Ticket #205)
- Emulator disk space may limit model downloads

# Local AI Feature Oracle

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Navigate to Local AI settings | Cloud/Local toggle visible | `uiautomator dump` + grep "Cloud\|Local" | 10s |
| 2 | Verify model cards | 4 model cards visible | `uiautomator dump` + grep model names | 3s |
| 3 | Tap download on model | Download progress shown | `uiautomator dump` + grep "downloading\|progress" | 5s |
| 4 | Toggle to Local | Local mode active | `uiautomator dump` + grep active toggle state | 2s |
| 5 | Verify Sideload APK guidance | arm64-v8a recommended for physical devices, universal for broad compatibility | `uiautomator dump` + grep "arm64-v8a\|universal" | 3s |
| 6 | Verify 16 KB alignment guidance | 16 KB page-size alignment note documented accurately for Android 15+ 16 KB mode | `uiautomator dump` + grep "16 KB" | 3s |

## Fail Conditions

- Model cards not rendering (API endpoint not reached)
- Download fails (disk space or MediaPipe version issue)
- Toggle state not persisted (state management bug)
- Incompatible ABI sideloaded (e.g. x86_64 APK on arm64 device leading to native engine failure)
- Overclaims 16 KB page-size requirement on Android 14 or standard 4 KB Android 15 devices
- Unaligned native libraries (.so) cause abort when loaded on 16 KB page-size kernel devices

## Notes

- Real `.task` bundle vs mock fallback decision pending (Ticket #205)
- Emulator disk space may limit model downloads

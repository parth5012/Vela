# Safety Tier Badges Oracle (E18)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Trigger Tool-Call Card | Tool execution card rendered in chat | `uiautomator dump` + grep tool card | 3s |
| 2 | Check Safety Tier Pill | Tier badge visible with valid tier (Tier 0 / Tier 1 / Tier 2) | `uiautomator dump` + grep "Tier 0\|Tier 1\|Tier 2\|Read-only\|Autonomous\|Approval" | 2s |
| 3 | Badge Style Verification | Tier pill has correct color accent | `screencap` + visual verification | 2s |

## Fail Conditions

- Missing safety tier indicator on tool calls
- Defaulting to insecure/unknown tier level without fallback
- Crash during safety tier derivation

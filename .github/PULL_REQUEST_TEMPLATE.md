## Summary
<!-- Concise description of changes, context, and motivation -->

Fixes # <!-- Issue number -->

---

## Factory Compliance

- **Contract sections touched**: <!-- e.g., Module Boundaries: Client Layering, Data Ownership, or None -->
- **CUJ impact**: <!-- e.g., CUJ-01 (cold start), CUJ-02 (send action), CUJ-03 (stream settle), or None -->
- **Ratchet result**: <!-- pass | report | na -->
- **Ledger row added**: <!-- yes | no (recorded in FACTORY_LEDGER.md) -->

---

## Verification
<!-- Commands run and evidence of green status -->
- [ ] `npm run arch:check` (0 boundary violations)
- [ ] `python vela_ci.py ci` (clean gate)
- [ ] `npx tsc --noEmit` (clean compile)
- [ ] Unit & integration tests pass

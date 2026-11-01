# Architecture Context Loader

This project enforces a certified architecture contract.

Before implementing features or modifying code boundaries:
- **Certified Contract**: Read [`docs/ARCHITECTURE_CONTRACT.md`](../../docs/ARCHITECTURE_CONTRACT.md).
- **Validation Audit**: Review [`docs/VALIDATOR_CHECKLIST.md`](../../docs/VALIDATOR_CHECKLIST.md).
- **CUJ Catalogue**: Inspect [`docs/CUJ_CATALOGUE.md`](../../docs/CUJ_CATALOGUE.md).

Boundary enforcement is machine-checked via `npm run arch:check` in `client/` and `pytest tests/test_architecture_boundaries.py` in `backend/`.

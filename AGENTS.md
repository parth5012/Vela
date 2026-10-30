## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Physical device policy

The ADB-connected Android device is the user's personal phone. Ask for approval
and wait for an explicit yes before installing any package other than the app
itself (notably instrumentation / `androidTest` APKs), uninstalling anything, or
deleting device files. Read-only inspection (`logcat`, `pm list`, `run-as ls`)
needs no approval. Full details in `client/AGENTS.md`.

## CI gate

`python vela_ci.py ci` (repo root) is the single definition of green — the same command locally, in GitHub Actions and in agent loops. Run it before reporting any task done. `--stack backend|client|corpus|e2e` narrows it; `--with-e2e` adds the Playwright UI suite; `python vela_ci.py corpus|e2e|bugs` runs one part. The ruff step only gates the lines your change touched.

- A bugfix PR ships a test that fails on the old code and passes after. Record it in `BUGS.toml` — `status = "fixed"` requires `failing_test`.
- Corpus pass floors only rise, and only through `backend/corpus/floors.py`. Never lower a floor or edit a fixture expectation to get green.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage role labels are used as-is: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

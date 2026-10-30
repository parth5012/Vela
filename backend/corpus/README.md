# Pinned transcript corpus

Small, single-feature conversations that are **replayed through the real
FastAPI app** with `FakeProvider`, a frozen clock and a seeded SQLite database.
The observed SSE stream and persisted turn are normalized and diffed against
checked-in expectations. Think of it as end-to-end golden files for the agent
turn contract.

This is the Vela analogue of ArtCraft's `photocraft-corpus`.

```
backend/corpus/
  transcripts/<feature>/<feature>-<variant>.json   # one fixture per file
  floors.py                                        # per-feature pass-count ratchet
  loader.py                                        # load / normalize / diff / sha256 manifest
  runner.py                                        # fixture -> real app -> observation
  regen.py                                         # re-record expectations + manifest
  SHA256SUMS                                       # <sha256>  <relative-path>
  README.md                                        # this runbook
```

## Run it

From `backend/`:

```bash
uv run pytest -m corpus tests/test_corpus.py      # the corpus only
uv run pytest tests/test_corpus.py                # same tests, no marker filter
uv run pytest                                     # full suite (marker is registered)
uv run ruff check corpus tests/test_corpus.py
```

The suite prints a per-feature table (`passed / fixtures / floor`) and fails if
any feature drops below its floor. A missing or empty corpus is a **failure**,
not a skip. A stale hash is a **failure** naming `SHA256SUMS`, never a skip.

## Fixture format

```json
{
  "feature": "plain-reply",
  "variant": "seeded-thread",
  "description": "one line about what this pins",
  "script": ["first provider turn", ["streamed ", "delta ", "turn"]],
  "prior_turns": [{ "message": "earlier user message" }],
  "prep": [{ "op": "set_dynamic_rules", "content": "..." }],
  "request": {
    "thread_id": "seeded",
    "message": "Hi Vela",
    "agent": "personal assistant"
  },
  "expected_prompt": { "contains": ["..."], "absent": ["..."] },
  "expected_events": [{ "type": "content", "delta": "..." }],
  "expected_persisted": {
    "user_query": "...",
    "agent_response": "...",
    "conversation_agent": "personal assistant",
    "conversation_source": "client",
    "conversation_title": "Seeded Chat 1",
    "thread_message_count": 4,
    "assistant_sync_messages": []
  }
}
```

* `script` — ordered provider turns. A string is one delta, a list of strings is
  several deltas, `{"tool_calls": [{name, args, id}]}` is a tool-calling turn.
* `request.thread_id` — a **mode token**, never a database id:
  * `seeded` → seeded thread 1 (`Seeded Chat 1`, agent `personal assistant`,
    source `client`),
  * `seeded_2` → seeded thread 2 (`Seeded Chat 2`, agent `teacher`),
  * `new` → a fixed corpus thread id; a new thread is created and starts as
    `New Chat` (so a title-generation provider turn is required).
* `prior_turns` — optional earlier user messages on the same thread; their
  scripted turns are consumed from `script` in order, before `request`.
* `prep` — optional DB setup: `set_conversation_source`, `set_conversation_title`,
  `set_dynamic_rules`, `clear_dynamic_rules`.
* `expected_events` / `expected_persisted` — generated, never hand-edited.
* `expected_prompt` — optional hand-written stable markers checked against the
  chatbot system prompt (`contains` / `absent`).

Every scripted turn must be consumed; an unconsumed turn fails the fixture (it
means the flow changed and the script is stale).

## Add a fixture

1. Create `transcripts/<feature>/<feature>-<variant>.json` with `feature`,
   `variant`, `description`, `script`, `request` (and `prior_turns` / `prep` /
   `expected_prompt` if needed). Leave `"expected_events": []` and
   `"expected_persisted": {}`.
2. Add the feature to `FLOORS` in `floors.py` (start at `1`; the ratchet will
   raise it to the achieved count).
3. From `backend/`: `uv run python -m corpus.regen --only <variant>`.
4. **Read the recorded diff.** Confirm the events and persisted turn are what
   you intended; the recorder writes whatever the app did.
5. `uv run pytest -m corpus tests/test_corpus.py`.
6. `uv run python -m corpus.regen --update-floors` to ratchet the floor.

## Regenerate expectations

```bash
uv run python -m corpus.regen              # re-record every fixture + rewrite SHA256SUMS
uv run python -m corpus.regen --check      # write nothing; exits 1 if anything drifted
uv run python -m corpus.regen --only title # only fixtures whose id contains "title"
uv run python -m corpus.regen --update-floors
```

Recording always runs against the throwaway SQLite test database (the script
claims the pytest session marker before importing `db.session`), so it can
never touch a real `DATABASE_URL`. No network, no real LLM, no sleeps.

Regeneration is only correct when the **behaviour change is intentional**.
Review the diff in the PR — a re-recorded fixture is a rewritten specification.

### When to bump hashes

`SHA256SUMS` is regenerated by `regen.py` on every recording run — never edit it
by hand. Bump (i.e. re-record) when:

* you intentionally change agent behaviour that a fixture covers,
* you add/remove/rename a fixture,
* a dependency upgrade changes a pinned transcript (for example the tool-output
  repr inside `<call:...>` spans) and review approves the new transcript.

Do **not** re-record to make a red test green without explaining why the
behaviour changed.

## Floors

`FLOORS[feature]` is the minimum number of that feature's fixtures that must
pass. Floors are ratchets:

* they start at the achieved pass count and may only rise;
* `regen.py --update-floors` prints `floor old -> new` and rewrites only when it
  can raise;
* if a run achieves **fewer** passes than the current floor, the recorder
  aborts with `refusing to lower/patch floors silently` and the pytest run
  fails on `test_feature_floors`. Fix the regression; a floor never drops
  without a reviewed, explicit edit.

Current corpus: 8 features, 11 fixtures.

## Volatility contract

The full list of values that normalization erases is in the module docstring of
`loader.py`: generated thread titles, ULIDs, UUIDs, ISO timestamps, epoch-ms
values, and absent optional event fields. Everything else — replies, tool-call
span text, error messages, prompt markers — is pinned verbatim.

Two deliberate exclusions:

* **Multiple tool calls in one assistant turn are not pinned.** LangGraph's
  `ToolNode` executes them concurrently, so `on_tool_start` / `on_tool_end`
  ordering is non-deterministic run to run. Pinning it would produce a flaky
  fixture; use two single-tool fixtures instead.
* **Model version / provider internals** never appear in the SSE contract and
  are not asserted.

If something looks flaky, normalize it explicitly in `loader.py` and document
why right there — do not widen the normalizer silently.

## Troubleshooting

| Symptom | Meaning / fix |
| --- | --- |
| `sha256 mismatch for transcripts/...` | Fixture edited without re-pinning. Revert, or re-record intentionally. |
| `fixture ... is not listed in SHA256SUMS` | New file added; run `uv run python -m corpus.regen`. |
| `manifest missing` | `SHA256SUMS` deleted; run `uv run python -m corpus.regen`. |
| `manifest lists ..., but the file does not exist` | Fixture removed; re-record. |
| `UNREADABLE-CORPUS-*` / `EMPTY-OR-MISSING-CORPUS` test id | Corpus or JSON is broken; the test fails on purpose. |
| `n scripted turn(s) never consumed` | The script no longer matches the flow (e.g. a thread now has a title). Update the script. |
| `PytestUnknownMarkWarning: corpus` | The marker is not registered; check `[tool.pytest.ini_options].markers` in `pyproject.toml`. |
| `test_vela_backend.db` left behind | Harmless scratch DB; `regen.py` deletes it after a recording run. |

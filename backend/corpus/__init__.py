"""Pinned transcript corpus for the Vela agent.

Replays small, single-feature conversations through the real FastAPI app with
``FakeProvider`` and diffs the normalized SSE stream + persisted turn against
checked-in expectations. See ``corpus/README.md`` for the runbook.
"""

from corpus.floors import FLOORS
from corpus.loader import (
    CORPUS_DIR,
    MANIFEST_NAME,
    TRANSCRIPTS_DIR,
    CorpusError,
    Fixture,
    compute_manifest_text,
    format_diff,
    load_all,
    load_fixture,
    normalize_events,
    normalize_persisted,
    normalize_prompt,
    verify_manifest,
)

__all__ = [
    "CORPUS_DIR",
    "FLOORS",
    "MANIFEST_NAME",
    "TRANSCRIPTS_DIR",
    "CorpusError",
    "Fixture",
    "compute_manifest_text",
    "format_diff",
    "load_all",
    "load_fixture",
    "normalize_events",
    "normalize_persisted",
    "normalize_prompt",
    "verify_manifest",
]

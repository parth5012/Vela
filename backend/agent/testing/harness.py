"""Deterministic test harness for Vela backend.

Wires FakeProvider into the agent graph / LLM dependency, configures
static API keys ("test-api-key"), freezes the clock, and resets/seeds the DB.
"""

from __future__ import annotations

import os
from collections.abc import Generator
from contextlib import contextmanager, suppress
from datetime import datetime
from typing import Any
from unittest.mock import patch

from fastapi.testclient import TestClient
from langchain_core.embeddings import Embeddings

from agent.testing.db import FIXED_DATETIME, SeededData, seed_db
from agent.testing.provider import FakeProvider
from utils.llm import (
    reset_embeddings_provider,
    reset_llm_provider,
    set_embeddings_provider,
    set_llm_provider,
)


class FakeEmbeddings(Embeddings):
    """Deterministic, zero-network embeddings model for tests."""

    def __init__(self, dimensions: int = 512):
        self.dimensions = dimensions

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * self.dimensions for _ in texts]

    def embed_query(self, text: str) -> list[float]:
        return [0.0] * self.dimensions


@contextmanager
def fixed_clock(target_dt: datetime = FIXED_DATETIME) -> Generator[datetime, None, None]:
    """Freeze utcnow_naive across db models to target_dt."""
    with patch("db.models.utcnow_naive", return_value=target_dt):
        yield target_dt


class DeterministicHarness:
    """Manages test environment overrides for fully deterministic test execution."""

    def __init__(
        self,
        provider: FakeProvider | None = None,
        api_key: str = "test-api-key",
        fixed_dt: datetime = FIXED_DATETIME,
        seed: bool = True,
    ):
        self.provider = provider if provider is not None else FakeProvider()
        self.api_key = api_key
        self.fixed_dt = fixed_dt
        self.seed = seed
        self.seeded_data: SeededData | None = None
        self._patches: list[Any] = []
        self._orig_env: dict[str, str | None] = {}

    def start(self) -> TestClient:
        # 1. Environment variables
        for key, val in [
            ("VELA_API_KEY", self.api_key),
            ("GOOGLE_API_KEY", self.api_key),
        ]:
            self._orig_env[key] = os.environ.get(key)
            os.environ[key] = val

        # 2. Wire FakeProvider & FakeEmbeddings into utils.llm
        set_llm_provider(self.provider)
        set_embeddings_provider(FakeEmbeddings())

        # 3. Patch utcnow_naive to frozen clock
        clock_patch = patch("db.models.utcnow_naive", return_value=self.fixed_dt)
        clock_patch.start()
        self._patches.append(clock_patch)

        # 4. Seed database
        if self.seed:
            self.seeded_data = seed_db()

        # 5. Build TestClient with static auth header
        from agent.main import app

        client = TestClient(
            app,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        # Attach harness properties to the client for convenience
        client.provider = self.provider  # type: ignore[attr-defined]
        client.seeded_data = self.seeded_data  # type: ignore[attr-defined]
        client.harness = self  # type: ignore[attr-defined]

        orig_close = client.close
        def _close_with_harness():
            try:
                self.stop()
            finally:
                orig_close()
        client.close = _close_with_harness  # type: ignore[method-assign]
        return client

    def stop(self) -> None:
        # 1. Reset LLM & embeddings providers
        reset_llm_provider()
        reset_embeddings_provider()

        # 2. Stop patches
        for p in reversed(self._patches):
            with suppress(Exception):
                p.stop()
        self._patches.clear()

        # 3. Restore environment
        for key, val in self._orig_env.items():
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val
        self._orig_env.clear()


@contextmanager
def deterministic_harness(
    provider: FakeProvider | None = None,
    api_key: str = "test-api-key",
    fixed_dt: datetime = FIXED_DATETIME,
    seed: bool = True,
) -> Generator[TestClient, None, None]:
    """Context manager providing a deterministic FastAPI TestClient."""
    harness = DeterministicHarness(
        provider=provider,
        api_key=api_key,
        fixed_dt=fixed_dt,
        seed=seed,
    )
    client = harness.start()
    try:
        yield client
    finally:
        harness.stop()


def get_deterministic_app(
    provider: FakeProvider | None = None,
    api_key: str = "test-api-key",
    fixed_dt: datetime = FIXED_DATETIME,
    seed: bool = True,
) -> tuple[TestClient, FakeProvider, SeededData | None]:
    """Helper to build a deterministic TestClient, returning (client, provider, seeded_data)."""
    harness = DeterministicHarness(
        provider=provider,
        api_key=api_key,
        fixed_dt=fixed_dt,
        seed=seed,
    )
    client = harness.start()
    return client, harness.provider, harness.seeded_data

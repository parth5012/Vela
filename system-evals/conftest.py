"""Pytest test harness and fixtures for system-evals."""

import os
import sys
import pytest
from pathlib import Path

# Add project root and backend to path
EVALS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = EVALS_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"

for d in [str(EVALS_DIR), str(BACKEND_DIR)]:
    if d not in sys.path:
        sys.path.insert(0, d)

# Set test environment flags
os.environ["TESTING"] = "1"
os.environ["VELA_EVAL_MODE"] = "1"
os.environ["VELA_TOOL_MODE"] = "dry_run"

@pytest.fixture(scope="session")
def eval_config():
    from config import config
    return config

@pytest.fixture
def dry_run_client():
    from adapters.client import VelaClient
    return VelaClient(in_process=True)
